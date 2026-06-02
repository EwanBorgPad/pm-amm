/**
 * Instruction builders for the 5 multi-outcome group-market instructions.
 */
import { SystemProgram, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { type IxContext, bn } from "./context";
import { deriveGroupPda } from "../pda";

export async function buildInitializeGroupMarket(
  ctx: IxContext,
  p: {
    authority: PublicKey;
    groupId: number | bigint;
    endTs: number | bigint;
    name: string;
    legCount: number;
  },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .initializeGroupMarket(bn(p.groupId), bn(p.endTs), p.name, p.legCount)
    .accountsPartial({
      authority: p.authority,
      groupMarket: deriveGroupPda(ctx.programId, p.groupId),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildAttachLegToGroup(
  ctx: IxContext,
  p: { authority: PublicKey; group: PublicKey; market: PublicKey; legIndex: number },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .attachLegToGroup(p.legIndex)
    .accountsPartial({ authority: p.authority, groupMarket: p.group, market: p.market })
    .instruction();
}

export async function buildResolveGroup(
  ctx: IxContext,
  p: { authority: PublicKey; group: PublicKey; winningLeg: number },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .resolveGroup(p.winningLeg)
    .accountsPartial({ authority: p.authority, groupMarket: p.group })
    .instruction();
}

export async function buildResolveGroupLeg(
  ctx: IxContext,
  p: { group: PublicKey; market: PublicKey; legIndex: number },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .resolveGroupLeg(p.legIndex)
    .accountsPartial({ groupMarket: p.group, market: p.market })
    .instruction();
}

export async function buildCancelGroupMarket(
  ctx: IxContext,
  p: { authority: PublicKey; group: PublicKey },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .cancelGroupMarket()
    .accountsPartial({ authority: p.authority, groupMarket: p.group })
    .instruction();
}
