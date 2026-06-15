import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// 実行時エラーで白画面になるのを防ぎ、原因を画面に表示する。
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error:', error, info);
  }

  render() {
    if (this.state.error) {
      // 詳細はコンソールに出し、画面には内部情報を露出しない固定文言を表示する
      return (
        <div className="p-6 text-sm text-gray-800">
          <h1 className="text-lg font-bold text-red-700 mb-2">エラーが発生しました</h1>
          <p>画面を表示できませんでした。時間をおいて再読み込みしてください。</p>
        </div>
      );
    }
    return this.props.children;
  }
}
