import { APP_ROUTES } from "./routes";
import { BATTLE_LOG_SCHEMA_VERSION } from "../core/events/schema";

const MILESTONES = [
  { id: "M0", label: "静的アプリ基盤", status: "進行中" },
  { id: "M1", label: "キャプチャ表示とROI調整", status: "次" },
  { id: "M2", label: "フレームサンプリングと前処理preview", status: "未着手" },
];

export function App() {
  return (
    <main className="app-shell">
      <section className="hero-panel" aria-labelledby="app-title">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">PokeChronicle</span>
        </div>
        <div className="hero-content">
          <h1 id="app-title">対戦映像を観測ログへ</h1>
          <p>
            ブラウザ内でキャプチャ映像を解析し、バトルメッセージのOCR結果とイベント候補を時系列に残すための静的Webアプリ基盤です。
          </p>
        </div>
        <dl className="status-grid" aria-label="M0 status">
          <div>
            <dt>runtime</dt>
            <dd>static browser app</dd>
          </div>
          <div>
            <dt>schema</dt>
            <dd>{BATTLE_LOG_SCHEMA_VERSION}</dd>
          </div>
          <div>
            <dt>route</dt>
            <dd>{APP_ROUTES.home.path}</dd>
          </div>
        </dl>
      </section>

      <section className="milestone-panel" aria-labelledby="milestone-title">
        <h2 id="milestone-title">MVP milestones</h2>
        <ol className="milestone-list">
          {MILESTONES.map((milestone) => (
            <li key={milestone.id}>
              <span className="milestone-id">{milestone.id}</span>
              <span className="milestone-label">{milestone.label}</span>
              <span className="milestone-status">{milestone.status}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

