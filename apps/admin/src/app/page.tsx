import { en } from "../i18n/en";

export default function Home() {
  return (
    <main>
      <div className="shell">
        <p className="stage">{en.stage}</p>
        <h1>{en.heading}</h1>
        <p className="intro">{en.message}</p>
        <p className="detail">{en.detail}</p>
      </div>
    </main>
  );
}
