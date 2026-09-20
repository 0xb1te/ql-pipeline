import { describe, expect, it, vi } from 'vitest';
import {
  isSelfApprovalRefusal,
  SELF_APPROVAL_NOTE,
  executeMergeDecision,
  findingToReviewComment,
  inlineComments,
  isDiffAnchored,
  recordVerdictLabel,
  unanchoredFindings,
  NEEDS_HUMAN_LABEL,
  READY_TO_MERGE_LABEL,
} from '../../src/merger/merger.js';
import type { GithubClient } from '../../src/shared/github-client.js';
import type { Finding, MergeConfig } from '../../src/shared/types.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'should',
    rule: 'frontend.rules#prefer-composition',
    file: 'src/components/Widget.tsx',
    line: 10,
    problem: 'consider composition over inheritance here',
    suggestedFix: null,
    autoFixable: false,
    ...overrides,
  };
}

const PR = {
  owner: '0xb1te',
  repo: 'ql-pipeline',
  number: 42,
  headRef: 'task/007-example',
  headSha: 'abc123',
};

/** A client whose PR head is still the SHA that was reviewed. */
function fakeClient(headSha = PR.headSha): GithubClient {
  return {
    listCommitMessages: vi.fn().mockResolvedValue([]),
    listChangedFiles: vi.fn().mockResolvedValue([]),
    getPullRequestDetails: vi.fn().mockResolvedValue({ description: '', diff: '' }),
    addLabels: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    postComment: vi.fn().mockResolvedValue(undefined),
    approveWithComments: vi.fn().mockResolvedValue(undefined),
    // Answers with the ids of the comments it created, so govern can reply in those threads.
    requestChangesWithComments: vi.fn().mockResolvedValue([]),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    getHeadSha: vi.fn().mockResolvedValue(headSha),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    commentReview: vi.fn().mockResolvedValue(undefined),
    listReviewThreads: vi.fn().mockResolvedValue([]),
    resolveReviewThread: vi.fn().mockResolvedValue(undefined),
  };
}

describe('findingToReviewComment', () => {
  it('maps file/line and includes the suggested fix when present', () => {
    const comment = findingToReviewComment(finding({ suggestedFix: 'extract a sub-component' }));

    expect(comment.path).toBe('src/components/Widget.tsx');
    expect(comment.line).toBe(10);
    expect(comment.body).toContain('[should] frontend.rules#prefer-composition');
    expect(comment.body).toContain('consider composition over inheritance here');
    expect(comment.body).toContain('Suggested fix: extract a sub-component');
  });

  it('omits the suggested-fix line when there is none', () => {
    const comment = findingToReviewComment(finding({ suggestedFix: null }));

    expect(comment.body).not.toContain('Suggested fix');
  });
});

describe('executeMergeDecision', () => {
  const mergeConfig: MergeConfig = {
    targetBranch: 'main',
    targetBranchByArea: {},
    method: 'merge',
    deleteBranch: true,
    requiredChecks: ['build', 'test', 'ai-review'],
    requireHumanApproval: false,
  };

  it('approves with no comments, merges, and deletes the branch when there are no advisory findings', async () => {
    const client = fakeClient();

    const result = await executeMergeDecision(client, PR, [], mergeConfig);

    expect(result).toEqual({ kind: 'merged', approval: 'approved' });
    expect(client.approveWithComments).toHaveBeenCalledWith(PR, []);
    expect(client.mergePullRequest).toHaveBeenCalledWith(PR, 'merge', 'abc123');
    expect(client.deleteBranch).toHaveBeenCalledWith(PR);
  });

  it('pins the reviewed SHA on the merge call so GitHub rejects a racing commit', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], mergeConfig);

    expect(client.mergePullRequest).toHaveBeenCalledWith(PR, 'merge', PR.headSha);
  });

  it('aborts without merging when the PR head moved since the review', async () => {
    const client = fakeClient('def456');

    const result = await executeMergeDecision(client, PR, [], mergeConfig);

    expect(result).toEqual({ kind: 'stale', reviewedSha: 'abc123', currentSha: 'def456' });
    expect(client.approveWithComments).not.toHaveBeenCalled();
    expect(client.mergePullRequest).not.toHaveBeenCalled();
    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  it('attaches advisory findings as review comments on approval', async () => {
    const client = fakeClient();
    const advisory = [finding()];

    await executeMergeDecision(client, PR, advisory, mergeConfig);

    expect(client.approveWithComments).toHaveBeenCalledWith(PR, [findingToReviewComment(advisory[0]!)]);
  });

  it('does not send a finding with no line to sit on as an inline comment', async () => {
    // GitHub rejects a review comment whose path is not in the diff with a 422, and
    // recordApproval rethrows anything that is not the self-approval refusal - so this would
    // have failed a run that had otherwise passed, over a finding that may not block.
    const client = fakeClient();

    await executeMergeDecision(client, PR, [finding({ file: '(task)' })], mergeConfig);

    expect(client.approveWithComments).toHaveBeenCalledWith(PR, []);
  });

  it('reports it as an ordinary pull-request comment instead, so it is still said', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [finding({ file: '(gate)', rule: 'gate#backend-test' })], mergeConfig);

    expect(client.postComment).toHaveBeenCalledWith(PR, expect.stringContaining('gate#backend-test'));
  });

  it('posts nothing extra when every advisory finding has a real line', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [finding()], mergeConfig);

    expect(client.postComment).not.toHaveBeenCalled();
  });

  it('still merges when an advisory finding has nowhere to point', async () => {
    const client = fakeClient();

    const result = await executeMergeDecision(client, PR, [finding({ file: '(task)' })], mergeConfig);

    expect(result).toEqual({ kind: 'merged', approval: 'approved' });
    expect(client.mergePullRequest).toHaveBeenCalledWith(PR, 'merge', PR.headSha);
  });

  it('reports an unanchored advisory in human-approval mode too', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [finding({ file: '(task)' })], {
      ...mergeConfig,
      requireHumanApproval: true,
    });

    expect(client.postComment).toHaveBeenCalledWith(PR, expect.stringContaining('Advisory findings'));
    expect(client.mergePullRequest).not.toHaveBeenCalled();
  });

  it('uses the configured merge method', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], { ...mergeConfig, method: 'squash' });

    expect(client.mergePullRequest).toHaveBeenCalledWith(PR, 'squash', PR.headSha);
  });

  it('does not delete the branch when deleteBranch is false', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], { ...mergeConfig, deleteBranch: false });

    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  it('checks staleness first, then approves, merges, and deletes in order', async () => {
    const order: string[] = [];
    const client: GithubClient = {
      ...fakeClient(),
      getHeadSha: vi.fn().mockImplementation(() => {
        order.push('staleness-check');
        return Promise.resolve(PR.headSha);
      }),
      approveWithComments: vi.fn().mockImplementation(() => {
        order.push('approve');
        return Promise.resolve();
      }),
      mergePullRequest: vi.fn().mockImplementation(() => {
        order.push('merge');
        return Promise.resolve();
      }),
      deleteBranch: vi.fn().mockImplementation(() => {
        order.push('delete');
        return Promise.resolve();
      }),
    };

    await executeMergeDecision(client, PR, [], mergeConfig);

    expect(order).toEqual(['staleness-check', 'approve', 'merge', 'delete']);
  });
});

describe('human-approval mode', () => {
  const humanApproval: MergeConfig = {
    targetBranch: 'main',
    targetBranchByArea: {},
    method: 'merge',
    deleteBranch: true,
    requiredChecks: ['build', 'test', 'ai-review'],
    requireHumanApproval: true,
  };

  it('never calls the merge API', async () => {
    // The whole point of the mode. If this ever passes while merge is called,
    // an unattended run could merge to main without a person.
    const client = fakeClient();

    const result = await executeMergeDecision(client, PR, [], humanApproval);

    expect(result).toEqual({ kind: 'awaiting-human', approval: 'approved' });
    expect(client.mergePullRequest).not.toHaveBeenCalled();
  });

  it('still approves the PR and attaches advisory findings', async () => {
    // The review is the valuable part and must survive the mode change —
    // a human deciding whether to merge needs to see what the pipeline found.
    const client = fakeClient();
    const advisory = [finding()];

    await executeMergeDecision(client, PR, advisory, humanApproval);

    expect(client.approveWithComments).toHaveBeenCalledWith(PR, [findingToReviewComment(advisory[0]!)]);
  });

  it('labels the PR so an orchestrator can find it', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], humanApproval);

    expect(client.addLabels).toHaveBeenCalledWith(PR, ['ready-to-merge']);
  });

  it('leaves the branch alone', async () => {
    // Deleting the branch of a PR nobody has merged would destroy the work.
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], humanApproval);

    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  it('still refuses a stale PR before approving anything', async () => {
    // The staleness check must run first in both modes, or a human would be
    // asked to approve a revision that was never reviewed.
    const client = fakeClient('def456');

    const result = await executeMergeDecision(client, PR, [], humanApproval);

    expect(result.kind).toBe('stale');
    expect(client.approveWithComments).not.toHaveBeenCalled();
    expect(client.addLabels).not.toHaveBeenCalled();
  });
});

/**
 * GitHub refuses to let anyone approve their own pull request. Once `GH_TOKEN` is a person's
 * token the pipeline *is* the author of everything that person opens, so the approve call that
 * had worked since the beginning started returning 422 and failing the whole governance run.
 */
describe('a pull request the pipeline itself opened', () => {
  const mergeConfig: MergeConfig = {
    targetBranch: 'main',
    targetBranchByArea: {},
    method: 'merge',
    deleteBranch: true,
    requiredChecks: ['build', 'test', 'ai-review'],
    requireHumanApproval: false,
  };

  function refusing(): { status: number; message: string } {
    return { status: 422, message: 'Unprocessable Entity: "Review Can not approve your own pull request"' };
  }

  it('recognises the refusal by status and message together', () => {
    expect(isSelfApprovalRefusal(refusing())).toBe(true);
  });

  it('does not mistake other 422s for it — they are real errors and must not be swallowed', () => {
    expect(isSelfApprovalRefusal({ status: 422, message: 'Validation Failed: line must be part of the diff' })).toBe(
      false,
    );
    expect(isSelfApprovalRefusal({ status: 403, message: 'own pull request' })).toBe(false);
    expect(isSelfApprovalRefusal(new Error('own pull request'))).toBe(false);
    expect(isSelfApprovalRefusal(null)).toBe(false);
  });

  it('records the verdict as a comment review instead of failing the run', async () => {
    const client = fakeClient();
    client.approveWithComments = vi.fn().mockRejectedValue(refusing());

    const result = await executeMergeDecision(client, PR, [], { ...mergeConfig, requireHumanApproval: true });

    expect(result).toEqual({ kind: 'awaiting-human', approval: 'self-authored' });
    expect(client.commentReview).toHaveBeenCalledWith(PR, SELF_APPROVAL_NOTE, []);
  });

  it('says in the note that a required approval must come from somebody else', () => {
    // Branch protection that demands an approving review cannot be satisfied by the pipeline at
    // all here, and a reader of the PR deserves to know that rather than wonder.
    expect(SELF_APPROVAL_NOTE).toContain('has to come from');
  });

  it('still rethrows any other failure — a review that did not land is a run that did not work', async () => {
    const client = fakeClient();
    client.approveWithComments = vi.fn().mockRejectedValue({ status: 500, message: 'Server Error' });

    await expect(executeMergeDecision(client, PR, [], mergeConfig)).rejects.toMatchObject({ status: 500 });
    expect(client.commentReview).not.toHaveBeenCalled();
  });
});

describe('verdict labels', () => {
  const mergeConfig: MergeConfig = {
    targetBranch: 'main',
    targetBranchByArea: {},
    method: 'merge',
    deleteBranch: true,
    requiredChecks: ['build', 'test', 'ai-review'],
    requireHumanApproval: true,
  };

  it('takes needs-human off the pull request it has just approved', async () => {
    // The bug. ql-desktop#72 ended a run wearing `needs-human, ready-to-merge`: an early run
    // escalated over a protected path, a later run approved once that path was narrowed, and
    // nothing ever removed the first verdict. Two answers, one of them false.
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], mergeConfig);

    expect(client.addLabels).toHaveBeenCalledWith(PR, [READY_TO_MERGE_LABEL]);
    expect(client.removeLabel).toHaveBeenCalledWith(PR, NEEDS_HUMAN_LABEL);
  });

  it('adds the verdict it reached before removing the one it did not', async () => {
    // Removing first would leave a window in which the pull request carries no verdict at all,
    // and anything reading labels in that window sees a run that decided nothing.
    const client = fakeClient();
    const order: string[] = [];
    client.addLabels = vi.fn().mockImplementation(() => {
      order.push('add');
      return Promise.resolve();
    });
    client.removeLabel = vi.fn().mockImplementation(() => {
      order.push('remove');
      return Promise.resolve();
    });

    await executeMergeDecision(client, PR, [], mergeConfig);

    expect(order).toEqual(['add', 'remove']);
  });

  it('clears needs-human on a pull request it merges outright', async () => {
    // A merged pull request still wearing `needs-human` is a false answer sitting in anybody's
    // history, and the merge path never added `ready-to-merge` to overwrite it.
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], { ...mergeConfig, requireHumanApproval: false });

    expect(client.removeLabel).toHaveBeenCalledWith(PR, NEEDS_HUMAN_LABEL);
  });

  it('clears it before the branch is deleted, while the pull request is still there to label', async () => {
    const client = fakeClient();
    const order: string[] = [];
    client.removeLabel = vi.fn().mockImplementation(() => {
      order.push('remove');
      return Promise.resolve();
    });
    client.deleteBranch = vi.fn().mockImplementation(() => {
      order.push('delete');
      return Promise.resolve();
    });

    await executeMergeDecision(client, PR, [], { ...mergeConfig, requireHumanApproval: false });

    expect(order).toEqual(['remove', 'delete']);
  });

  it('does not touch labels on a stale head, because no verdict was reached', async () => {
    const client = fakeClient('def456');

    await executeMergeDecision(client, PR, [], mergeConfig);

    expect(client.addLabels).not.toHaveBeenCalled();
    expect(client.removeLabel).not.toHaveBeenCalled();
  });
});

describe('recordVerdictLabel', () => {
  it('puts on the escalation and takes off the approval', async () => {
    const client = fakeClient();

    await recordVerdictLabel(client, PR, NEEDS_HUMAN_LABEL);

    expect(client.addLabels).toHaveBeenCalledWith(PR, [NEEDS_HUMAN_LABEL]);
    expect(client.removeLabel).toHaveBeenCalledWith(PR, READY_TO_MERGE_LABEL);
  });

  it('puts on the approval and takes off the escalation', async () => {
    const client = fakeClient();

    await recordVerdictLabel(client, PR, READY_TO_MERGE_LABEL);

    expect(client.addLabels).toHaveBeenCalledWith(PR, [READY_TO_MERGE_LABEL]);
    expect(client.removeLabel).toHaveBeenCalledWith(PR, NEEDS_HUMAN_LABEL);
  });
});

describe('isDiffAnchored', () => {
  it('accepts a finding that names a real file', () => {
    expect(isDiffAnchored(finding({ file: 'src/components/Widget.tsx' }))).toBe(true);
  });

  it('rejects the pseudo-paths used for a finding about the PR rather than a line in it', () => {
    expect(isDiffAnchored(finding({ file: '(gate)' }))).toBe(false);
    expect(isDiffAnchored(finding({ file: '(task)' }))).toBe(false);
  });

  it('does not mistake a real path that merely contains parentheses', () => {
    expect(isDiffAnchored(finding({ file: 'src/(group)/page.tsx' }))).toBe(true);
  });

  it('treats an empty pair of parentheses as a real path, having no marker in it', () => {
    expect(isDiffAnchored(finding({ file: '()' }))).toBe(true);
  });
});

describe('inlineComments', () => {
  it('drops a blocking gate finding, which is the case that used to 422 the run', () => {
    // A failed *required* gate is `must`, not `should`, so it never went near the approval path
    // where isDiffAnchored was applied. It went to requestChangesWithComments unfiltered, and
    // GitHub refused a comment on `(gate)` - killing the review that existed to explain it.
    const comments = inlineComments([
      finding({ severity: 'must', rule: 'gate#backend-test', file: '(gate)' }),
      finding({ severity: 'must', file: 'src/api/payments.ts', line: 12 }),
    ]);

    expect(comments).toHaveLength(1);
    expect(comments[0]?.path).toBe('src/api/payments.ts');
  });

  it('keeps every finding that names a real file, whatever its severity', () => {
    const comments = inlineComments([
      finding({ severity: 'security', file: 'a.ts' }),
      finding({ severity: 'must', file: 'b.ts' }),
      finding({ severity: 'should', file: 'c.ts' }),
    ]);

    expect(comments.map((comment) => comment.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('returns nothing rather than throwing when every finding is about the PR itself', () => {
    expect(inlineComments([finding({ file: '(gate)' }), finding({ file: '(task)' })])).toEqual([]);
  });
});

describe('unanchoredFindings', () => {
  it('is the exact complement of what inlineComments keeps, so nothing falls between them', () => {
    // The two are only safe as a pair. A finding in neither list is one the PR never hears about.
    const findings = [
      finding({ file: '(gate)' }),
      finding({ file: 'src/a.ts' }),
      finding({ file: '(task)' }),
    ];

    expect(inlineComments(findings).length + unanchoredFindings(findings).length).toBe(findings.length);
    expect(unanchoredFindings(findings).map((entry) => entry.file)).toEqual(['(gate)', '(task)']);
  });
});
