import { describe, expect, it, vi } from 'vitest';
import { executeMergeDecision, findingToReviewComment } from '../../src/merger/merger.js';
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
    postComment: vi.fn().mockResolvedValue(undefined),
    approveWithComments: vi.fn().mockResolvedValue(undefined),
    // Answers with the ids of the comments it created, so govern can reply in those threads.
    requestChangesWithComments: vi.fn().mockResolvedValue([]),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    getHeadSha: vi.fn().mockResolvedValue(headSha),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
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

    expect(result).toEqual({ kind: 'merged' });
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

    expect(result).toEqual({ kind: 'awaiting-human' });
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
