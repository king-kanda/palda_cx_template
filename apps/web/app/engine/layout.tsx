export const metadata = { title: "Engine · Palda CX" };

/** Everything under /engine uses the warm console theme (see `.engine-theme` in globals.css). */
export default function EngineRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="engine-theme">{children}</div>;
}
