import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

const SCRIPT = path.join(__dirname, '..', 'scripts', 'collect-preview-rules.js');
const REPO = 'owner/repo';

function rulesFor(marker: string): string {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // === APP RULES BEGIN ===
    match /${marker}/{id} {
      allow read: if true;
    }
    // === APP RULES END ===
  }
}
`;
}

// 開いている PR の一覧と、各 head の firestore.rules を返すだけのスタブ。
// 実際の GitHub API の代わりに GITHUB_API_URL で差し向ける。
function startStub(pulls: unknown[], contents: Record<string, string>) {
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    requested.push(req.url || '');
    const url = new URL(req.url || '', 'http://localhost');
    if (url.pathname === `/repos/${REPO}/pulls`) {
      // 2 ページ目以降は空にして、ページ送りの終了条件を確かめる
      const page = Number(url.searchParams.get('page') || '1');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(page === 1 ? pulls : []));
      return;
    }
    if (url.pathname === `/repos/${REPO}/contents/firestore.rules`) {
      const ref = url.searchParams.get('ref') || '';
      if (contents[ref] === undefined) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"message":"Not Found"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(contents[ref]);
      return;
    }
    res.writeHead(500);
    res.end();
  });
  return new Promise<{ url: string; requested: string[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requested,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe('collect-preview-rules', () => {
  let out: string;

  beforeEach(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'previews-'));
  });

  afterEach(() => {
    fs.rmSync(out, { recursive: true, force: true });
  });

  test('開いている PR のルールを チャンネル名.rules として集める', async () => {
    const stub = await startStub(
      [
        { number: 12, head: { sha: 'a'.repeat(40), repo: { full_name: REPO } } },
        { number: 34, head: { sha: 'b'.repeat(40), repo: { full_name: REPO } } },
      ],
      { ['a'.repeat(40)]: rulesFor('twelve'), ['b'.repeat(40)]: rulesFor('thirtyfour') },
    );
    try {
      await run('node', [SCRIPT, '--repo', REPO, '--out', out], {
        env: { ...process.env, GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'stub' },
      });
      expect(fs.readdirSync(out).sort()).toEqual(['pr-12.rules', 'pr-34.rules']);
      expect(fs.readFileSync(path.join(out, 'pr-12.rules'), 'utf8')).toContain('/twelve/');
      expect(fs.readFileSync(path.join(out, 'pr-34.rules'), 'utf8')).toContain('/thirtyfour/');
    } finally {
      await stub.close();
    }
  });

  test('フォークからの PR は対象にしない', async () => {
    const stub = await startStub(
      [
        { number: 12, head: { sha: 'a'.repeat(40), repo: { full_name: REPO } } },
        { number: 99, head: { sha: 'c'.repeat(40), repo: { full_name: 'someone/fork' } } },
      ],
      { ['a'.repeat(40)]: rulesFor('twelve'), ['c'.repeat(40)]: rulesFor('fork') },
    );
    try {
      await run('node', [SCRIPT, '--repo', REPO, '--out', out], {
        env: { ...process.env, GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'stub' },
      });
      expect(fs.readdirSync(out)).toEqual(['pr-12.rules']);
      // フォークの head は読みにすらいかない
      expect(stub.requested.some((u) => u.includes('c'.repeat(40)))).toBe(false);
    } finally {
      await stub.close();
    }
  });

  test('ルールを読めない PR があっても、ほかの PR の収集は続く', async () => {
    const stub = await startStub(
      [
        { number: 12, head: { sha: 'a'.repeat(40), repo: { full_name: REPO } } },
        // このブランチには firestore.rules が無い（404 を返す）
        { number: 34, head: { sha: 'd'.repeat(40), repo: { full_name: REPO } } },
      ],
      { ['a'.repeat(40)]: rulesFor('twelve') },
    );
    try {
      const { stderr } = await run('node', [SCRIPT, '--repo', REPO, '--out', out], {
        env: { ...process.env, GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'stub' },
      });
      expect(fs.readdirSync(out)).toEqual(['pr-12.rules']);
      expect(stderr).toContain('pr-34');
    } finally {
      await stub.close();
    }
  });

  test('一覧そのものが取れなければ失敗する', async () => {
    const stub = await startStub([], {});
    try {
      await expect(
        run('node', [SCRIPT, '--repo', 'other/repo', '--out', out], {
          env: { ...process.env, GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'stub' },
        }),
      ).rejects.toThrow();
    } finally {
      await stub.close();
    }
  });
});
