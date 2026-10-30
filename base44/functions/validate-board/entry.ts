import { createClientFromRequest } from "npm:@base44/sdk@0.8.57";
import { resolveClaim } from "../../shared/game.js";
import { errMsg, parseJsonBody } from "../../shared/media.ts";

// One "¡Lotería!" from a phone. The winner rules (first valid shout wins, a winner is never
// replaced, concurrent claims settle to the same answer) live in shared/game.js and are tested there.
export default async function (req: Request): Promise<Response> {
  const t0 = Date.now();
  const base44 = createClientFromRequest(req);
  const body = await parseJsonBody(req);
  const boardId = String(body.boardId ?? "").trim();
  if (!boardId) return Response.json({ error: "boardId is required" }, { status: 400 });

  try {
    const res = await resolveClaim(base44.asServiceRole.entities, {
      boardId,
      marked: Array.isArray(body.marked) ? body.marked : undefined,
      gameId: typeof body.gameId === "string" ? body.gameId : undefined,
    });
    console.log(`validate-board: board ${boardId} valid=${res.valid} line=${JSON.stringify(res.winningLine)} first=${res.isFirstWinner} winner=${res.winnerName} called=${res.calledCount} ${Date.now() - t0} ms`);
    return Response.json(res);
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const status = (e as any)?.status === 404 || (e as any)?.status === 400 ? (e as any).status : 500;
    const error = errMsg(e);
    console.log(`validate-board: failure (${status}): ${error}`);
    return Response.json({ error }, { status });
  }
}
