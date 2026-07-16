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

function fakeClient(): GithubClient {
  return {
    listCommitMessages: vi.fn().mockResolvedValue([]),
    listChangedFiles: vi.fn().mockResolvedValue([]),
    getPullRequestDetails: vi.fn().mockResolvedValue({ description: '', diff: '' }),
    addLabels: vi.fn().mockResolvedValue(undefined),
    postComment: vi.fn().mockResolvedValue(undefined),
    approveWithComments: vi.fn().mockResolvedValue(undefined),
    requestChangesWithComments: vi.fn().mockResolvedValue(undefined),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
  };
}

const PR = { owner: '0xb1te', repo: 'ql-pipeline', number: 42, headRef: 'task/007-example' };

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
    method: 'merge',
    deleteBranch: true,
    requiredChecks: ['build', 'test', 'ai-review'],
  };

  it('approves with no comments, merges, and deletes the branch when there are no advisory findings', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], mergeConfig);

    expect(client.approveWithComments).toHaveBeenCalledWith(PR, []);
    expect(client.mergePullRequest).toHaveBeenCalledWith(PR, 'merge');
    expect(client.deleteBranch).toHaveBeenCalledWith(PR);
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

    expect(client.mergePullRequest).toHaveBeenCalledWith(PR, 'squash');
  });

  it('does not delete the branch when deleteBranch is false', async () => {
    const client = fakeClient();

    await executeMergeDecision(client, PR, [], { ...mergeConfig, deleteBranch: false });

    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  it('approves before merging, and merges before deleting the branch', async () => {
    const order: string[] = [];
    const client: GithubClient = {
      listCommitMessages: vi.fn().mockResolvedValue([]),
      listChangedFiles: vi.fn().mockResolvedValue([]),
      getPullRequestDetails: vi.fn().mockResolvedValue({ description: '', diff: '' }),
      addLabels: vi.fn().mockResolvedValue(undefined),
      postComment: vi.fn().mockResolvedValue(undefined),
      approveWithComments: vi.fn().mockImplementation(() => {
        order.push('approve');
        return Promise.resolve();
      }),
      requestChangesWithComments: vi.fn().mockResolvedValue(undefined),
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

    expect(order).toEqual(['approve', 'merge', 'delete']);
  });
});
