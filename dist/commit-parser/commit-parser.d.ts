import { type ParsedCommit } from '../shared/types.js';
/**
 * Parses a single commit message's header line against the grammar
 * `<type>(<area>): <description>`. Only the first line is considered;
 * body/footer content does not affect parsing. Returns null for anything
 * that doesn't match — callers decide what an unparseable header means.
 */
export declare function parseCommitHeader(message: string): ParsedCommit | null;
export interface CommitParseResult {
    readonly parsed: readonly ParsedCommit[];
    readonly unparsed: readonly string[];
}
/**
 * Parses a batch of commit messages (e.g. every commit on a PR). Messages
 * that don't match the grammar are collected separately rather than
 * discarded — routing policy (fallback to the PR title, etc.) decides what
 * to do with them, this module only parses.
 */
export declare function parseCommits(messages: readonly string[]): CommitParseResult;
