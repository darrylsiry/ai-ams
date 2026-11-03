import { Card, PageHeader, Pill, Table, cls } from "@/components/ui";
import { roadmapList } from "@/lib/roadmap";

export const metadata = { title: "Roadmap" };

export default function Roadmap() {
  const items = roadmapList();
  return (
    <div>
      <PageHeader crumbs={[{ href: "/admin", label: "Admin" }]} title="Roadmap: shown but not in the MVP" subtitle="Every control in the app marked 'Coming later' (not in the MVP) or 'Needs setup' (in the MVP, waiting on an outside dependency) links to its row here. IDs are keyed to the master process catalog (docs/AMS-Process-Catalog.md) and the MVP scope (docs/AMS-MVP-Scope.md)." />
      <Card><Table head={["Feature", "Why", "Status", "Phase", "Catalog ID"]}>
        {items.map((r) => <tr key={r.id} id={r.id} className="scroll-mt-20 target:bg-amber-50"><td className={cls.td}>{r.label}</td><td className={`${cls.td} text-xs`}>{r.why}</td><td className={cls.td}>{r.kind === "pending" ? <Pill tone="amber">Pending dependency</Pill> : <Pill>Not in MVP</Pill>}</td><td className={`${cls.td} text-xs`}>{r.phase}</td><td className={`${cls.td} font-mono text-xs`}>{r.id}</td></tr>)}
      </Table></Card>
    </div>
  );
}
