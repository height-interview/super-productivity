import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Task } from 'src/app/features/tasks/task.model';
import { catchError, first, map, switchMap } from 'rxjs/operators';
import { IssueServiceInterface } from '../../issue-service-interface';
import { JiraApiService } from './jira-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { ProjectService } from '../../../project/project.service';
import { SearchResultItem } from '../../issue.model';
import { JiraIssue, JiraIssueReduced } from './jira-issue/jira-issue.model';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';
import { mapJiraAttachmentToAttachment } from './jira-issue/jira-issue-map.util';
import { JiraCfg } from './jira.model';

@Injectable({
  providedIn: 'root',
})
export class JiraCommonInterfacesService implements IssueServiceInterface {
  constructor(
    private readonly _jiraApiService: JiraApiService,
    private readonly _snackService: SnackService,
    private readonly _projectService: ProjectService,
  ) {}

  // NOTE: we're using the issueKey instead of the real issueId
  getById$(issueId: string | number, projectId: string): Observable<JiraIssue> {
    return this._getCfgOnce$(projectId).pipe(
      switchMap((jiraCfg) =>
        this._jiraApiService.getIssueById$(issueId as string, jiraCfg),
      ),
    );
  }

  // NOTE: this gives back issueKey instead of issueId
  searchIssues$(searchTerm: string, projectId: string): Observable<SearchResultItem[]> {
    return this._getCfgOnce$(projectId).pipe(
      switchMap((jiraCfg) =>
        jiraCfg && jiraCfg.isEnabled
          ? this._jiraApiService
              .issuePicker$(searchTerm, jiraCfg)
              .pipe(catchError(() => []))
          : of([]),
      ),
    );
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: JiraIssue;
    issueTitle: string;
  } | null> {
    if (!task.projectId) {
      throw new Error('No projectId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await this._getCfgOnce$(task.projectId).toPromise();
    const issue = (await this._jiraApiService
      .getIssueById$(task.issueId, cfg)
      .toPromise()) as JiraIssue;

    // @see https://developer.atlassian.com/cloud/jira/platform/jira-expressions-type-reference/#date
    const newUpdated = new Date(issue.updated).getTime();
    const wasUpdated = newUpdated > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: issue.key,
      };
    }
    return null;
  }

  getAddTaskData(issue: JiraIssueReduced): Partial<Task> & { title: string } {
    return {
      title: `${issue.key} ${issue.summary}`,
      issuePoints: issue.storyPoints,
      // circumvent errors for old jira versions #652
      issueAttachmentNr: issue.attachments ? issue.attachments.length : 0,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated).getTime(),
    };
  }

  issueLink$(issueId: string | number, projectId: string): Observable<string> {
    if (!issueId || !projectId) {
      throw new Error('No issueId or no projectId');
    }
    // const isIssueKey = isNaN(Number(issueId));
    return this._projectService.getJiraCfgForProject$(projectId).pipe(
      first(),
      map((jiraCfg) => jiraCfg.host + '/browse/' + issueId),
    );
  }

  async getNewIssuesToAddToBacklog(
    projectId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<JiraIssueReduced[]> {
    const cfg = await this._getCfgOnce$(projectId).toPromise();
    return await this._jiraApiService.findAutoImportIssues$(cfg).toPromise();
  }

  getMappedAttachments(issueData: JiraIssue): TaskAttachment[] {
    return (
      issueData &&
      issueData.attachments &&
      issueData.attachments.map(mapJiraAttachmentToAttachment)
    );
  }

  private _getCfgOnce$(projectId: string): Observable<JiraCfg> {
    return this._projectService.getJiraCfgForProject$(projectId).pipe(first());
  }
}
