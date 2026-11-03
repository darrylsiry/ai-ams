import { Card, PageHeader } from "@/components/ui";
import { ASSISTANT_MODEL, assistantConfigured } from "@/lib/assistant";
import { DEFAULTS, getSetting } from "@/lib/settings";
import { can, currentUser, type User } from "@/lib/user";
import { AssistantChat } from "./chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Assistant" };

function suggestionsFor(u: User): string[] {
  const common = ["What should I work on next?", "What's overdue on my desk, and why does it matter?", "Which of my renewals expire in the next 30 days?"];
  if (u.role === "producer") return ["How much have I written this year?", "What's in my sales pipeline?", "What's on my latest commission statement?", ...common.slice(0, 1)];
  if (u.role === "accounting") return ["Where does the trust account stand?", "Which invoices are more than 30 days past due?", "Which commission statements still have unmatched lines?", "How much is owed to each carrier?"];
  if (can(u, "team")) return ["What's most at risk across the agency right now?", "Who is overloaded this week?", "How did production compare to last year, by producer?", ...common.slice(0, 1), "Which claims haven't been reported to the carrier?"];
  return [...common, "Are there any claims not yet reported to the carrier?", "Which certificates are on policies no longer in force?"];
}

/** Ask anything about the agency's work; Claude answers from the app's data, with links, limited to what this role can see. */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [user, sp, allowed] = await Promise.all([currentUser(), searchParams, getSetting("ai_assists", DEFAULTS.ai_assists)]);
  const off = !assistantConfigured() ? "The AI Assistant isn't set up on this server yet: it needs an Anthropic API key (ANTHROPIC_API_KEY). Everything else in the app works without it."
    : allowed.assistant === false ? "An administrator has turned the AI Assistant off in Admin > Settings." : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 4000) : undefined;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="AI Assistant" subtitle="Ask a question about anything in the AMS. Every answer is looked up in the app and links to the records it rests on." />
      <AssistantChat userId={user.id} firstName={user.full_name.split(" ")[0]} model={ASSISTANT_MODEL} enabled={!off} offReason={off} suggestions={suggestionsFor(user)} prefill={q || undefined} />
      {off && <Card className="mt-4" pad><p className="text-sm text-slate-600">You can still find anything with the search box at the top of the page.</p></Card>}
    </div>
  );
}
