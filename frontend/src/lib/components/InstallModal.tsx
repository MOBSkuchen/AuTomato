import { useEffect, useState } from "react";

interface Props {
  onClose: () => void;
}

type SourceKind = "git" | "http-tar";

interface InstallSuccess {
  id: string;
  already_present: boolean;
  module: { name: string; version: string };
}

const BACKEND_URL =
  (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } }).env
    ?.VITE_BACKEND_URL ?? "http://localhost:7878";

export default function InstallModal({ onClose }: Props) {
  const [kind, setKind] = useState<SourceKind>("git");
  const [url, setUrl] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const versionLabel =
    kind === "git" ? "Ref (tag, branch, or commit)" : "SHA-256";
  const versionPlaceholder =
    kind === "git" ? "v1.2.3 or main or <commit>" : "64 hex chars";
  const urlPlaceholder =
    kind === "git"
      ? "https://github.com/owner/repo.git"
      : "https://host/path/file.tar.gz";

  const canSubmit = url.trim() !== "" && version.trim() !== "" && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setOkMessage(null);
    try {
      const resp = await fetch(`${BACKEND_URL}/modules/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          url: url.trim(),
          version: version.trim(),
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(text || `HTTP ${resp.status} ${resp.statusText}`);
        return;
      }
      const body = (await resp.json()) as InstallSuccess;
      setOkMessage(
        body.already_present
          ? `Already cached: ${body.module.name}@${body.module.version}`
          : `Installed ${body.module.name}@${body.module.version}`,
      );
      setTimeout(() => onClose(), 700);
    } catch (e) {
      setError(`Backend unreachable: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="overlay"
      role="button"
      tabIndex={-1}
      aria-label="Close"
      onClick={onClose}
    >
      <div
        className="panel install-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Install module"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Install module</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <form onSubmit={submit}>
          <section>
            <div className="install-kind">
              <label className="menu-radio">
                <input
                  type="radio"
                  name="install-kind"
                  checked={kind === "git"}
                  onChange={() => setKind("git")}
                />
                <span>Git repository</span>
              </label>
              <label className="menu-radio">
                <input
                  type="radio"
                  name="install-kind"
                  checked={kind === "http-tar"}
                  onChange={() => setKind("http-tar")}
                />
                <span>HTTP tarball (.tar.gz)</span>
              </label>
            </div>

            <label className="install-field">
              <span>URL</span>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={urlPlaceholder}
                autoFocus
              />
            </label>

            <label className="install-field">
              <span>{versionLabel}</span>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder={versionPlaceholder}
              />
            </label>

            <p className="install-hint">
              {kind === "git"
                ? "Pin to an exact tag or commit. The cache key is derived from kind + url + ref, so two refs of the same repo produce two cached entries."
                : "The SHA-256 acts as both integrity check and cache key. The download is rejected on mismatch."}
            </p>

            {error && (
              <pre className="install-error" role="alert">
                {error}
              </pre>
            )}
            {okMessage && <div className="install-ok">{okMessage}</div>}
          </section>

          <footer className="install-footer">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!canSubmit}
            >
              {busy ? "Installing…" : "Install"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
