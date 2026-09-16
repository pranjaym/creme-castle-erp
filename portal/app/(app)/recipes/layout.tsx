// Every recipe screen renders inside .rx so its controls share one size
// (Pranjay, 16 Sep 2026: "the boxes are so big and small").
export default function RecipesLayout({ children }: { children: React.ReactNode }) {
  return <div className="rx">{children}</div>;
}
