// @neuron scaffold.core.doctor
import {
  PREVIEW_CONTRACT_NODE,
  PREVIEW_ENVIRONMENT_DIR,
  type PreviewEnvironmentVerdict,
} from '../verdict/preview-environment.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** What to do about it, when there is something to do. */
  readonly fix?: string;
}

export interface DoctorInput {
  readonly callerWorkflowPresent: boolean;
  readonly callerWorkflowReferencesPipeline: boolean;
  /** The caller workflow's own text, or null when none was found. */
  readonly callerWorkflowText: string | null;
  readonly configPresent: boolean;
  /** null when the config is absent or unparseable. */
  readonly configError: string | null;
  readonly targetBranch: string | null;
  readonly gatedAreas: readonly string[];
  readonly standardsEnabled: boolean;
  readonly standardsRootPresent: boolean;
  /** Configured standards documents that are not on disk. */
  readonly missingStandardsDocs: readonly string[];
  readonly standardsIgnored: boolean;
  readonly cursorRuleCount: number;
  /**
   * Whether the repository's preview environment satisfies ql-docs' contract, as decided by
   * verdict.decision.previewEnvironment - `not-required` for a repository with no product apps.
   */
  readonly previewEnvironment: PreviewEnvironmentVerdict;
}

/**
 * Everything `doctor` can determine without network access or secrets.
 *
 * It deliberately cannot verify that `GH_PACKAGES_TOKEN`, `CURSOR_API_KEY`,
 * `QL_PIPELINE_AGENT_API_KEY`, `OPENAI_API_KEY`, `QL_HOUSE_API_URL`,
 * `QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`, or `QL_AUTH_CLIENT_SECRET` are set —
 * those live in GitHub Actions secrets, which a local CLI has no business
 * reading. It says so rather than implying a clean bill of health it
 * cannot give. It also never reaches house-api itself: `govern` is the only
 * thing that does, in CI, where those secrets actually live.
 */
// @signal runDoctorChecks
export function runDoctorChecks(input: DoctorInput): CheckResult[] {
  const results: CheckResult[] = [];

  results.push(callerWorkflowCheck(input));
  results.push(callerConcurrencyCheck(input));
  results.push(configCheck(input));
  results.push(gatesCheck(input));
  results.push(...standardsChecks(input));
  results.push(cursorRulesCheck(input));
  results.push(previewEnvironmentCheck(input));

  return results;
}

/**
 * The same verdict `govern` fails a pull request on, reported here so an author finds out before
 * opening one. The rules themselves live in the ql-docs contract node and are cited, not restated.
 */
function previewEnvironmentCheck(input: DoctorInput): CheckResult {
  const name = 'preview environment';
  const verdict = input.previewEnvironment;
  if (verdict.kind === 'not-required') {
    return {
      name,
      status: 'pass',
      detail: 'not required — no apps/*frontend* or apps/*backend* directory, so there is no product to preview',
    };
  }
  if (verdict.kind === 'valid') {
    return { name, status: 'pass', detail: `${PREVIEW_ENVIRONMENT_DIR}/ satisfies the preview environment contract` };
  }
  return {
    name,
    status: 'fail',
    detail: `${String(verdict.violations.length)} contract violation(s): ${verdict.violations.join(' ')}`,
    fix: `see ${PREVIEW_CONTRACT_NODE} — govern fails every pull request until this is fixed`,
  };
}

function callerWorkflowCheck(input: DoctorInput): CheckResult {
  if (!input.callerWorkflowPresent) {
    return {
      name: 'caller workflow',
      status: 'fail',
      detail: 'no workflow calling ql-pipeline was found',
      fix: 'run `ql-pipeline init`',
    };
  }
  if (!input.callerWorkflowReferencesPipeline) {
    return {
      name: 'caller workflow',
      status: 'warn',
      detail: 'a governance workflow exists but does not reference ql-pipeline',
      fix: 'check that it `uses:` 0xb1te/ql-pipeline/.github/workflows/pr-pipeline.yml',
    };
  }
  return { name: 'caller workflow', status: 'pass', detail: 'present and calling ql-pipeline' };
}

/**
 * Whether a comment can cancel the run that wrote it.
 *
 * The documented concurrency recipe keys one group per PR and cancels in
 * progress, so that a new commit supersedes the run for the old one. With the
 * comment triggers on, that same group also catches the pipeline's own verdict
 * comment: posting it queues a run, and the queued run cancels the one that was
 * posting.
 *
 * The marker guard cannot help. It lives in the resolve job, and concurrency is
 * evaluated before any job starts - so the new run is declined a few seconds
 * after it has already killed its parent. What the operator sees is a red
 * `checks / ql-pipeline` on a pull request the engine actually approved, because
 * a cancelled check is not a green one.
 *
 * Naming the event in the group separates the two intentions: a commit still
 * supersedes the run for the previous commit, and a comment no longer
 * supersedes the run that is mid-verdict.
 */
/**
 * The `concurrency:` block's own lines - the indented ones under it, and the
 * blank lines between them.
 *
 * Read as lines rather than matched as one expression because the group is long
 * enough to want a folded scalar, which puts the interesting part on a line of
 * its own. Anything that only looked at `group:` would call a fixed workflow
 * broken, which is a worse failure than the one this exists to report.
 */
function concurrencyBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.startsWith('concurrency:'));
  if (first === -1) return '';
  const block: string[] = [];
  for (const line of lines.slice(first + 1)) {
    if (line.trim() === '') {
      block.push(line);
      continue;
    }
    if (!/^[ \t]/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

function callerConcurrencyCheck(input: DoctorInput): CheckResult {
  const text = input.callerWorkflowText;
  const name = 'caller concurrency';
  if (text === null) {
    return { name, status: 'warn', detail: 'no caller workflow to read', fix: 'run `ql-pipeline init`' };
  }
  const takesComments = /issue_comment:|pull_request_review_comment:/.test(text);
  const block = concurrencyBlock(text);
  const cancels = /cancel-in-progress:\s*true/.test(block);
  if (!takesComments || !cancels) {
    return { name, status: 'pass', detail: 'no comment trigger and cancellation combined' };
  }
  // How a caller spells the distinction is its own business; that it draws one
  // at all is what this checks.
  if (block.includes('event_name')) {
    return { name, status: 'pass', detail: 'commit runs and comment runs are grouped apart' };
  }
  return {
    name,
    status: 'warn',
    detail:
      'comment-triggered runs share a concurrency group with commit-triggered ones, so the ' +
      "pipeline's own verdict comment cancels the run posting it",
    fix: "add github.event_name to the concurrency group, so a comment cannot cancel a commit's run",
  };
}

function configCheck(input: DoctorInput): CheckResult {
  if (!input.configPresent) {
    return {
      name: 'pipeline config',
      status: 'fail',
      detail: 'no pipeline config found',
      fix: 'run `ql-pipeline init`',
    };
  }
  if (input.configError !== null) {
    return {
      name: 'pipeline config',
      status: 'fail',
      detail: input.configError,
      fix: 'fix the config; the pipeline fails closed rather than guessing',
    };
  }
  return { name: 'pipeline config', status: 'pass', detail: `valid, target branch "${input.targetBranch ?? '?'}"` };
}

function gatesCheck(input: DoctorInput): CheckResult {
  if (input.configError !== null || !input.configPresent) {
    return { name: 'gates', status: 'warn', detail: 'not checked — the config could not be read' };
  }
  if (input.gatedAreas.length === 0) {
    return {
      name: 'gates',
      status: 'warn',
      detail: 'no area has build or test commands configured, so those checks will pass vacuously',
      fix: 'set gates.<area>.build / .test in the pipeline config',
    };
  }
  return { name: 'gates', status: 'pass', detail: `configured for ${input.gatedAreas.join(', ')}` };
}

function standardsChecks(input: DoctorInput): CheckResult[] {
  // Without a readable config we do not know what the standards settings
  // are — saying "disabled" would state as fact something we never read.
  if (!input.configPresent || input.configError !== null) {
    return [{ name: 'standards', status: 'warn', detail: 'not checked — the config could not be read' }];
  }

  if (!input.standardsEnabled) {
    return [
      {
        name: 'standards',
        status: 'warn',
        detail: 'disabled — PRs are reviewed against rules only, not the house engineering standards',
      },
    ];
  }

  const results: CheckResult[] = [];

  if (!input.standardsRootPresent) {
    results.push({
      name: 'standards',
      status: 'warn',
      detail: 'not checked out locally (govern reads house-api instead, so this only affects your editor)',
      fix: 'git clone git@github.com:0xb1te/ql-docs.git .standards',
    });
    return results;
  }

  if (input.missingStandardsDocs.length > 0) {
    results.push({
      name: 'standards',
      status: 'fail',
      detail: `${input.missingStandardsDocs.length} configured document(s) missing: ${input.missingStandardsDocs.join(', ')}`,
      fix: 'update the checkout (`git -C .standards pull`) so workflow/review/pr-* exists',
    });
  } else {
    results.push({ name: 'standards', status: 'pass', detail: 'all configured documents resolve' });
  }

  if (!input.standardsIgnored) {
    results.push({
      name: 'standards ignored',
      status: 'warn',
      detail: 'the standards checkout is not in .gitignore and could be committed by accident',
      fix: "echo '.standards/' >> .gitignore",
    });
  }

  return results;
}

function cursorRulesCheck(input: DoctorInput): CheckResult {
  if (input.cursorRuleCount === 0) {
    return {
      name: 'cursor rules',
      status: 'warn',
      detail: 'none installed — the editor will not follow the same standards the reviewer applies',
      fix: 'run `ql-pipeline init`',
    };
  }
  return { name: 'cursor rules', status: 'pass', detail: `${input.cursorRuleCount} rule(s) installed` };
}

// @signal worstStatus
export function worstStatus(results: readonly CheckResult[]): CheckStatus {
  if (results.some((result) => result.status === 'fail')) {
    return 'fail';
  }
  return results.some((result) => result.status === 'warn') ? 'warn' : 'pass';
}
