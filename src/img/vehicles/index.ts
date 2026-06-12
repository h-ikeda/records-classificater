// 車両名から画像を引くためのテーブル。キーは正規化済みの名前。
const images: Record<string, string> = {
  golf7: new URL('./Golf7.png', import.meta.url).href,
  none: new URL('./N-One.png', import.meta.url).href,
};

// "N-ONE" と "N-One"、"Golf 7" と "Golf7" のような表記ゆれを吸収する
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function vehicleImage(name?: string): string | undefined {
  if (!name) return undefined;
  const key = normalize(name);
  if (!key) return undefined;
  if (images[key]) return images[key];
  return Object.entries(images).find(([k]) => key.includes(k) || k.includes(key))?.[1];
}
