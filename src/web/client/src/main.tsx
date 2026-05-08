import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Activity,
    AlertTriangle,
    Clock3,
    FilePlus2,
    Gauge,
    Globe2,
    LayoutDashboard,
    ListChecks,
    PauseCircle,
    PlayCircle,
    RefreshCw,
    RotateCcw,
    Search,
    Settings,
    ShieldAlert,
    TerminalSquare,
    Trash2,
    Upload,
    UserRound,
    Zap,
} from 'lucide-react';
import './styles.css';

type Language = 'en' | 'zh';
type View = 'dashboard' | 'tasks' | 'create-task' | 'queue' | 'schedules' | 'settings';
type TaskStatus = 'not_queued' | 'pending' | 'running' | 'paused' | 'done' | 'blocked';
type QueueStatus = Exclude<TaskStatus, 'not_queued'>;
type DetailTab = 'overview' | 'files' | 'runs' | 'logs';
type LogStream = 'stdout' | 'stderr';

interface TaskMetadata {
    taskId: string;
    type: string;
    title: string;
    runner: string;
    budgetUsd: number;
    maxRetries: number;
    timeoutMs: number;
    createdAt: string;
    createdBy: { kind: string; sourceId?: string };
    retryCount: number;
    status: TaskStatus;
    statusUpdatedAt: string;
    latestRunId: string | null;
    lastEnqueuedAt: string | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
}

interface RunMeta {
    runId: string;
    taskId: string;
    runner: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    sessionRef?: string;
    reason?: string;
}

interface TaskDetails {
    task: TaskMetadata;
    queueStatus: QueueStatus | null;
    latestRun: TaskRunDetails | null;
}

interface TaskRunDetails {
    runMeta: RunMeta | null;
    result: { status: string; reason?: string; artifactRefs?: string[] } | null;
    artifacts: string[];
}

interface QueueItem {
    taskId: string;
    enteredAt: string;
    task: TaskMetadata;
}

interface ScheduleItem {
    schedule: {
        scheduleId: string;
        type: string;
        title: string;
        runner: string;
        cron: string;
        skipIfActive: boolean;
        enabled: boolean;
    };
    state: {
        lastTriggeredAt?: string | null;
        lastAction?: string | null;
        lastTaskId?: string | null;
        lastRunStatus?: string | null;
        stats?: Record<string, number>;
        timing?: Record<string, number | null>;
    } | null;
}

interface AppData {
    status: { readOnly: boolean; running: boolean; pid: number | null; counts: Record<string, number> };
    tasks: TaskMetadata[];
    queue: Record<QueueStatus, QueueItem[]>;
    schedules: ScheduleItem[];
    logs: string[];
}

interface TaskFileEntry {
    path: string;
    kind: 'file' | 'directory';
    size: number;
}

interface TaskTypeDefinition {
    type: string;
    label?: string;
    description: string;
    defaultRunner?: 'claude' | 'codex';
    defaultBudgetUsd?: number;
    defaultMaxRetries?: number;
    defaultTimeoutMs?: number;
}

interface DraftMessage {
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
}

interface TaskDraftState {
    draftId: string;
    kind: 'task';
    taskType: TaskTypeDefinition;
    creationMethod: 'claude' | 'codex' | 'manual';
    createdAt: string;
    updatedAt: string;
    guidePath: string | null;
    transcript: DraftMessage[];
}

interface TaskDraftSummary {
    draft: TaskDraftState;
    files: TaskFileEntry[];
    taskMd: string;
}

interface TaskCreateOptions {
    taskTypes: TaskTypeDefinition[];
    creationMethods: Array<'claude' | 'codex' | 'manual'>;
    availableCreationMethods: Array<'claude' | 'codex'>;
    knownRunners: Array<'claude' | 'codex'>;
    availableRunners: Array<'claude' | 'codex'>;
}

const queueStatuses: QueueStatus[] = ['pending', 'running', 'paused', 'blocked', 'done'];
const taskStatuses: Array<TaskStatus | 'all'> = ['all', 'not_queued', 'pending', 'running', 'paused', 'blocked', 'done'];

const messages: Record<Language, Record<string, string>> = {
    en: {
        workspace: 'Workspace',
        dashboard: 'Dashboard',
        tasks: 'Tasks',
        'create-task': 'Create Task',
        queue: 'Queue',
        schedules: 'Schedules',
        settings: 'Settings',
        search: 'Search title, id, type, runner',
        all: 'All',
        not_queued: 'Not queued',
        pending: 'Pending',
        running: 'Running',
        paused: 'Paused',
        blocked: 'Blocked',
        done: 'Done',
        userRequired: 'User required',
        change: 'Change',
        refresh: 'Refresh',
        autoRefresh: 'Auto refresh',
        readOnly: 'Read-only',
        writeEnabled: 'Write enabled',
        currentRun: 'Current Run',
        recentFailures: 'Recent Failures',
        recentLog: 'Recent System Log',
        taskDetail: 'Task Detail',
        selectTask: 'Select a task',
        latestRun: 'Latest Run',
        artifacts: 'Artifacts',
        download: 'Download',
        newTask: 'New Task',
        createTask: 'Create Task',
        taskType: 'Task Type',
        creationMethod: 'Creation Method',
        createDraft: 'Start draft',
        draftFiles: 'Draft Files',
        saveFile: 'Save file',
        assistant: 'Assistant',
        send: 'Send',
        assistantWorking: 'Assistant is organizing the draft...',
        assistantPlaceholder: 'Describe the task you want to create, or ask the assistant to refine task.md.',
        createAsDraft: 'Create as not queued',
        createAndEnqueue: 'Create and enqueue',
        newFilePath: 'New file path',
        createEmptyFile: 'Create',
        uploadFile: 'Upload',
        uploading: 'Uploading...',
        manual: 'Manual',
        loading: 'Loading...',
        logViewer: 'Log Viewer',
        overview: 'Overview',
        stdout: 'stdout',
        stderr: 'stderr',
        logs: 'Logs',
        runsTitle: 'Runs',
        selectedRun: 'Selected Run',
        followLogs: 'Live follow',
        following: 'Following new output',
        viewingHistory: 'Viewing earlier output',
        pausedLive: 'Live follow is off',
        startFollowing: 'Start live follow',
        stopFollowing: 'Stop live follow',
        jumpToBottom: 'Jump to bottom',
        noRunSelected: 'Select a run to inspect.',
        latestActivity: 'Latest Activity',
        enqueue: 'Enqueue',
        resume: 'Resume',
        rerun: 'Rerun',
        abandon: 'Abandon',
        cancel: 'Cancel',
        stop: 'Stop',
        remove: 'Remove',
        files: 'Files',
        definition: 'Definition',
        preview: 'Preview',
        spec: 'Spec',
        workdir: 'Workdir',
        clearHistory: 'Clear history',
        clearHistoryBody: 'Remove done and blocked historical tasks from this workspace.',
        clearHistoryConfirm: 'Remove done and blocked historical tasks?',
        removed: 'Removed',
        process: 'Process',
        pid: 'PID',
        runNow: 'Run now',
        clearTasks: 'Clear tasks',
        removeSchedule: 'Remove schedule',
        enable: 'Enable',
        disable: 'Disable',
        queueTruth: 'Queue Truth',
        scheduleState: 'Schedule State',
        language: 'Language',
        displayName: 'Display Name',
        save: 'Save',
        localOnly: 'Stored in this browser',
        actorTitle: 'Set your display name',
        actorBody: 'Write actions require a display name. It is used for audit logs only, not authentication.',
        continue: 'Continue',
        invalidName: 'Enter 1 to 40 characters.',
        noLogs: 'No logs.',
        noArtifacts: 'No artifacts.',
        empty: 'Nothing here yet.',
        taskId: 'Task ID',
        type: 'Type',
        runner: 'Runner',
        retry: 'Retry',
        budget: 'Budget',
        created: 'Created',
        started: 'Started',
        finished: 'Finished',
        session: 'Session',
        reason: 'Reason',
        enabled: 'Enabled',
        disabled: 'Disabled',
        lanNotice: 'LAN access has no authentication. Use trusted networks only.',
    },
    zh: {
        workspace: '工作区',
        dashboard: '仪表盘',
        tasks: '任务',
        'create-task': '创建任务',
        queue: '队列',
        schedules: '定时任务',
        settings: '设置',
        search: '搜索标题、ID、类型、Runner',
        all: '全部',
        not_queued: '未入队',
        pending: '待执行',
        running: '运行中',
        paused: '暂停',
        blocked: '阻塞',
        done: '完成',
        userRequired: '需要用户',
        change: '切换',
        refresh: '刷新',
        autoRefresh: '自动刷新',
        readOnly: '只读模式',
        writeEnabled: '允许写操作',
        currentRun: '当前运行',
        recentFailures: '最近失败',
        recentLog: '最近系统日志',
        taskDetail: '任务详情',
        selectTask: '选择一个任务',
        latestRun: '最新运行',
        artifacts: '产物',
        download: '下载',
        newTask: '新建任务',
        createTask: '创建任务',
        taskType: '任务类型',
        creationMethod: '创建方式',
        createDraft: '开始草稿',
        draftFiles: '草稿文件',
        saveFile: '保存文件',
        assistant: '创建助手',
        send: '发送',
        assistantWorking: '创建助手正在整理草稿...',
        assistantPlaceholder: '描述你想创建的任务，或让助手继续整理 task.md。',
        createAsDraft: '创建为未入队',
        createAndEnqueue: '创建并入队',
        newFilePath: '新文件路径',
        createEmptyFile: '新建',
        uploadFile: '上传',
        uploading: '上传中...',
        manual: '手工创建',
        loading: '加载中...',
        logViewer: '日志查看',
        overview: '概览',
        stdout: 'stdout',
        stderr: 'stderr',
        logs: '日志',
        runsTitle: '运行记录',
        selectedRun: '当前选中运行',
        followLogs: '实时跟随',
        following: '正在跟随新增日志',
        viewingHistory: '正在查看较早日志',
        pausedLive: '已关闭实时跟随',
        startFollowing: '开启实时跟随',
        stopFollowing: '停止实时跟随',
        jumpToBottom: '回到底部',
        noRunSelected: '请选择一条运行记录。',
        latestActivity: '最近执行',
        enqueue: '入队',
        resume: '恢复',
        rerun: '重跑',
        abandon: '放弃',
        cancel: '取消',
        stop: '停止',
        remove: '删除',
        files: '文件',
        definition: '任务定义',
        preview: '预览',
        spec: '材料',
        workdir: '执行目录',
        clearHistory: '清除历史',
        clearHistoryBody: '删除当前工作区中已完成和已阻塞的历史任务。',
        clearHistoryConfirm: '确认删除已完成和已阻塞的历史任务？',
        removed: '已删除',
        process: '进程',
        pid: 'PID',
        runNow: '立即运行',
        clearTasks: '清理任务实例',
        removeSchedule: '删除定时任务',
        enable: '启用',
        disable: '停用',
        queueTruth: '队列真相',
        scheduleState: '调度状态',
        language: '语言',
        displayName: '显示名称',
        save: '保存',
        localOnly: '保存在当前浏览器',
        actorTitle: '设置你的显示名称',
        actorBody: '写操作必须携带显示名称。它只用于审计日志，不是登录认证。',
        continue: '继续',
        invalidName: '请输入 1 到 40 个字符。',
        noLogs: '暂无日志。',
        noArtifacts: '暂无产物。',
        empty: '暂时没有内容。',
        taskId: '任务 ID',
        type: '类型',
        runner: 'Runner',
        retry: '重试',
        budget: '预算',
        created: '创建',
        started: '开始',
        finished: '结束',
        session: '会话',
        reason: '原因',
        enabled: '已启用',
        disabled: '已停用',
        lanNotice: '局域网访问没有认证，请只在可信网络使用。',
    },
};

function App() {
    const [language, setLanguage] = useLocalStorage<Language>('drift:language', 'en');
    const [actor, setActor] = useLocalStorage<string>('drift:userName', '');
    const [view, setView] = useState<View>('dashboard');
    const [data, setData] = useState<AppData | null>(null);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [selectedTaskRevealSeq, setSelectedTaskRevealSeq] = useState(0);
    const [taskDetails, setTaskDetails] = useState<TaskDetails | null>(null);
    const [taskRuns, setTaskRuns] = useState<RunMeta[]>([]);
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [selectedRunDetails, setSelectedRunDetails] = useState<TaskRunDetails | null>(null);
    const [detailTab, setDetailTab] = useState<DetailTab>('overview');
    const [logText, setLogText] = useState('');
    const [logStream, setLogStream] = useState<LogStream>('stdout');
    const [tailLogs, setTailLogs] = useState(true);
    const [fileArea, setFileArea] = useState<'spec' | 'workdir'>('spec');
    const [taskFiles, setTaskFiles] = useState<TaskFileEntry[]>([]);
    const [selectedFile, setSelectedFile] = useState('task.md');
    const [fileText, setFileText] = useState('');
    const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
    const [query, setQuery] = useState('');
    const [autoRefresh, setAutoRefresh] = useLocalStorage<string>('drift:autoRefresh', 'true');
    const [actorDraft, setActorDraft] = useState(actor);
    const [taskCreateOptions, setTaskCreateOptions] = useState<TaskCreateOptions | null>(null);
    const [taskCreateType, setTaskCreateType] = useState('');
    const [taskCreateMethod, setTaskCreateMethod] = useState<'claude' | 'codex' | 'manual'>('manual');
    const [taskDraft, setTaskDraft] = useState<TaskDraftSummary | null>(null);
    const [taskDraftFile, setTaskDraftFile] = useState('task.md');
    const [taskDraftFileText, setTaskDraftFileText] = useState('');
    const [taskDraftMessage, setTaskDraftMessage] = useState('');
    const [taskDraftTitle, setTaskDraftTitle] = useState('');
    const [taskDraftRunner, setTaskDraftRunner] = useState<'claude' | 'codex'>('claude');
    const [taskDraftBudget, setTaskDraftBudget] = useState('10');
    const [taskDraftMaxRetries, setTaskDraftMaxRetries] = useState('3');
    const [taskDraftTimeoutMs, setTaskDraftTimeoutMs] = useState('1800000');
    const [taskDraftNewFile, setTaskDraftNewFile] = useState('');
    const [taskCreateBusy, setTaskCreateBusy] = useState(false);
    const [taskDraftAssistantBusy, setTaskDraftAssistantBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const t = useCallback((key: string) => messages[language][key] ?? messages.en[key] ?? key, [language]);
    const formatDateTimeLocal = useCallback((value?: string | null) => formatDateTime(value, language), [language]);
    const validActor = actor.trim().length > 0 && actor.trim().length <= 40;

    const selectTask = useCallback((taskId: string, options: { reveal?: boolean } = {}) => {
        setSelectedTaskId(taskId);
        if (options.reveal) {
            setSelectedTaskRevealSeq(current => current + 1);
        }
    }, []);

    const loadAll = useCallback(async () => {
        const [status, tasks, queue, schedules, logs] = await Promise.all([
            api<AppData['status']>('/api/status'),
            api<{ tasks: TaskMetadata[] }>('/api/tasks'),
            api<{ queue: Record<QueueStatus, QueueItem[]> }>('/api/queue'),
            api<{ schedules: ScheduleItem[] }>('/api/schedules'),
            api<{ lines: string[] }>('/api/logs/system'),
        ]);
        setData({ status, tasks: tasks.tasks, queue: queue.queue, schedules: schedules.schedules, logs: logs.lines });
        setError(null);
        if (!selectedTaskId && tasks.tasks.length > 0) {
            const newestTask = [...tasks.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
            if (newestTask) setSelectedTaskId(newestTask.taskId);
        }
    }, [selectedTaskId]);

    useEffect(() => {
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
        localStorage.setItem('drift:language', language);
    }, [language]);

    useEffect(() => {
        loadAll().catch(err => setError(err instanceof Error ? err.message : String(err)));
    }, [loadAll]);

    useEffect(() => {
        if (autoRefresh !== 'true') return;
        const timer = window.setInterval(() => {
            loadAll().catch(() => undefined);
        }, 10_000);
        return () => window.clearInterval(timer);
    }, [autoRefresh, loadAll]);

    useEffect(() => {
        if (!taskCreateOptions) return;
        if (!taskCreateType && taskCreateOptions.taskTypes[0]) {
            setTaskCreateType(taskCreateOptions.taskTypes[0].type);
        }
        if (!taskCreateOptions.creationMethods.includes(taskCreateMethod)) {
            setTaskCreateMethod(taskCreateOptions.creationMethods[0] ?? 'manual');
        }
        if (!taskCreateOptions.knownRunners.includes(taskDraftRunner)) {
            setTaskDraftRunner(taskCreateOptions.knownRunners[0] ?? 'claude');
        }
    }, [taskCreateOptions, taskCreateType, taskCreateMethod, taskDraftRunner]);

    useEffect(() => {
        if (!taskDraft) return;
        const suggested = suggestTitleFromTaskMd(taskDraft.taskMd);
        if (!taskDraftTitle.trim() && suggested) {
            setTaskDraftTitle(suggested);
        }
        const typeDefaults = taskDraft.draft.taskType;
        setTaskDraftRunner(typeDefaults.defaultRunner ?? taskCreateOptions?.knownRunners[0] ?? 'claude');
        setTaskDraftBudget(String(typeDefaults.defaultBudgetUsd ?? 10));
        setTaskDraftMaxRetries(String(typeDefaults.defaultMaxRetries ?? 3));
        setTaskDraftTimeoutMs(String(typeDefaults.defaultTimeoutMs ?? 1800000));
        setTaskDraftFile('task.md');
        setTaskDraftFileText(taskDraft.taskMd);
    }, [taskDraft?.draft.draftId]);

    useEffect(() => {
        if (!selectedTaskId) return;
        Promise.all([
            api<TaskDetails>(`/api/tasks/${encodeURIComponent(selectedTaskId)}`),
            api<{ runs: RunMeta[] }>(`/api/tasks/${encodeURIComponent(selectedTaskId)}/runs`),
            api<{ files: TaskFileEntry[] }>(`/api/tasks/${encodeURIComponent(selectedTaskId)}/files?area=${fileArea}`),
            apiText(`/api/tasks/${encodeURIComponent(selectedTaskId)}/files/content?area=spec&path=task.md`).catch(() => ''),
        ])
            .then(([details, runs, files, taskText]) => {
                setTaskDetails(details);
                setTaskRuns(runs.runs);
                const latestAvailableRunId = details.task.latestRunId ?? runs.runs.at(-1)?.runId ?? null;
                setSelectedRunId(current => (current && runs.runs.some(run => run.runId === current) ? current : latestAvailableRunId));
                setSelectedRunDetails(details.task.latestRunId === latestAvailableRunId ? details.latestRun : null);
                setTaskFiles(files.files);
                setSelectedFile('task.md');
                setFileText(taskText);
                setLogText('');
                setLogStream('stdout');
            })
            .catch(err => setError(err instanceof Error ? err.message : String(err)));
    }, [selectedTaskId, fileArea]);

    const filteredTasks = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return [...(data?.tasks ?? [])]
            .filter(task => {
                if (filter !== 'all' && task.status !== filter) return false;
                if (!normalized) return true;
                return [task.title, task.taskId, task.type, task.runner, task.status].some(value =>
                    String(value).toLowerCase().includes(normalized),
                );
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, [data?.tasks, filter, query]);

    const runningTasks = data?.tasks.filter(task => task.status === 'running') ?? [];
    const recentFailures = data?.tasks.filter(task => task.status === 'blocked').slice(-8).reverse() ?? [];
    const readOnly = Boolean(data?.status.readOnly);

    async function runAction(action: 'enqueue' | 'resume' | 'rerun' | 'abandon' | 'cancel' | 'stop' | 'remove', taskId: string) {
        if (!validActor) return;
        const reason =
            action === 'abandon' || action === 'cancel' || action === 'stop' || action === 'remove'
                ? window.prompt(t('reason'), action === 'stop' ? 'Task stopped by user' : 'Task cancelled') ?? undefined
                : undefined;
        await api(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
            actor,
        });
        await loadAll();
        if (action === 'remove') {
            setSelectedTaskId(null);
            setTaskDetails(null);
            setSelectedRunId(null);
            setSelectedRunDetails(null);
            return;
        }
        setTaskDetails(await api<TaskDetails>(`/api/tasks/${encodeURIComponent(taskId)}`));
    }

    const loadLog = useCallback(async (stream: LogStream, runId: string, tail = false) => {
        if (!taskDetails) return;
        setLogText(
            await apiText(
                `/api/tasks/${encodeURIComponent(taskDetails.task.taskId)}/runs/${encodeURIComponent(
                    runId,
                )}/logs/${stream}${tail ? '?tailBytes=65536' : ''}`,
            ),
        );
    }, [taskDetails?.task.taskId]);

    useEffect(() => {
        if (!selectedTaskId || !selectedRunId) {
            setSelectedRunDetails(null);
            return;
        }
        if (taskDetails?.task.latestRunId === selectedRunId && taskDetails.latestRun) {
            setSelectedRunDetails(taskDetails.latestRun);
            return;
        }
        setSelectedRunDetails(null);
        api<TaskRunDetails>(`/api/tasks/${encodeURIComponent(selectedTaskId)}/runs/${encodeURIComponent(selectedRunId)}`)
            .then(setSelectedRunDetails)
            .catch(err => setError(err instanceof Error ? err.message : String(err)));
    }, [selectedTaskId, selectedRunId, taskDetails]);

    useEffect(() => {
        if (!selectedRunId || detailTab !== 'logs') {
            if (detailTab === 'logs') setLogText('');
            return;
        }
        setLogText('');
        loadLog(logStream, selectedRunId, tailLogs).catch(err => setError(err instanceof Error ? err.message : String(err)));
        if (!tailLogs) return;
        const timer = window.setInterval(() => {
            loadLog(logStream, selectedRunId, true).catch(() => undefined);
        }, 2000);
        return () => window.clearInterval(timer);
    }, [selectedRunId, detailTab, logStream, tailLogs, loadLog]);

    async function loadTaskFile(area: 'spec' | 'workdir', ref: string) {
        if (!taskDetails) return;
        setFileArea(area);
        setSelectedFile(ref);
        setFileText(
            await apiText(
                `/api/tasks/${encodeURIComponent(taskDetails.task.taskId)}/files/content?area=${area}&path=${encodeURIComponent(ref)}`,
            ).catch(error => (error instanceof Error ? error.message : String(error))),
        );
    }

    async function clearTaskHistory() {
        if (!validActor || !window.confirm(t('clearHistoryConfirm'))) return;
        const result = await api<{ removed: number }>('/api/tasks/clear-history', {
            method: 'POST',
            body: JSON.stringify({ statuses: ['done', 'blocked'] }),
            actor,
        });
        window.alert(`${t('removed')}: ${result.removed}`);
        await loadAll();
    }

    async function runScheduleAction(action: 'enable' | 'disable' | 'run' | 'clear-tasks' | 'remove', scheduleId: string) {
        if (!validActor) return;
        if ((action === 'remove' || action === 'clear-tasks') && !window.confirm(t(action === 'remove' ? 'removeSchedule' : 'clearTasks'))) return;
        await api(`/api/schedules/${encodeURIComponent(scheduleId)}/${action}`, {
            method: 'POST',
            body: '{}',
            actor,
        });
        await loadAll();
    }

    async function openTaskCreate() {
        setView('create-task');
        setError(null);
        if (!taskCreateOptions) {
            setTaskCreateOptions(await api<TaskCreateOptions>('/api/task-create/options'));
        }
    }

    async function createTaskDraftWorkspace() {
        if (!validActor || !taskCreateType) return;
        setTaskCreateBusy(true);
        try {
            const summary = await api<TaskDraftSummary>('/api/drafts/tasks', {
                method: 'POST',
                body: JSON.stringify({ type: taskCreateType, creationMethod: taskCreateMethod }),
                actor,
            });
            setTaskDraft(summary);
            setTaskDraftFile('task.md');
            setTaskDraftFileText(summary.taskMd);
            setTaskDraftMessage('');
            setTaskDraftTitle(suggestTitleFromTaskMd(summary.taskMd));
            setTaskDraftNewFile('');
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setTaskCreateBusy(false);
        }
    }

    async function loadDraftFile(ref: string) {
        if (!taskDraft) return;
        setTaskDraftFile(ref);
        try {
            const text = await apiText(`/api/drafts/tasks/${encodeURIComponent(taskDraft.draft.draftId)}/files/content?path=${encodeURIComponent(ref)}`);
            setTaskDraftFileText(text);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }

    async function saveDraftFile(ref: string, content: string) {
        if (!taskDraft || !validActor) return;
        setTaskCreateBusy(true);
        try {
            const summary = await api<TaskDraftSummary>(`/api/drafts/tasks/${encodeURIComponent(taskDraft.draft.draftId)}/files/content`, {
                method: 'POST',
                body: JSON.stringify({ path: ref, content }),
                actor,
            });
            setTaskDraft(summary);
            setTaskDraftFile(ref);
            setTaskDraftFileText(content);
            if (ref === 'task.md') {
                setTaskDraftTitle(current => current || suggestTitleFromTaskMd(content));
            }
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setTaskCreateBusy(false);
        }
    }

    async function sendDraftMessage() {
        if (!taskDraft || !validActor || !taskDraftMessage.trim()) return;
        setTaskCreateBusy(true);
        setTaskDraftAssistantBusy(true);
        try {
            const result = await api<{ draft: TaskDraftSummary; reply: string }>(`/api/drafts/tasks/${encodeURIComponent(taskDraft.draft.draftId)}/session`, {
                method: 'POST',
                body: JSON.stringify({ message: taskDraftMessage.trim() }),
                actor,
            });
            setTaskDraft(result.draft);
            if (taskDraftFile === 'task.md') {
                setTaskDraftFileText(result.draft.taskMd);
            }
            setTaskDraftMessage('');
            setTaskDraftTitle(current => current || suggestTitleFromTaskMd(result.draft.taskMd));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setTaskCreateBusy(false);
            setTaskDraftAssistantBusy(false);
        }
    }

    async function finalizeTaskDraftWorkspace(enqueue: boolean) {
        if (!taskDraft || !validActor) return;
        setTaskCreateBusy(true);
        try {
            const result = await api<{ task: TaskMetadata; enqueued: boolean }>(`/api/drafts/tasks/${encodeURIComponent(taskDraft.draft.draftId)}/finalize`, {
                method: 'POST',
                body: JSON.stringify({
                    title: taskDraftTitle,
                    runner: taskDraftRunner,
                    budgetUsd: Number(taskDraftBudget),
                    maxRetries: Number(taskDraftMaxRetries),
                    timeoutMs: Number(taskDraftTimeoutMs),
                    enqueue,
                }),
                actor,
            });
            await loadAll();
            setTaskDraft(null);
            setView('tasks');
            selectTask(result.task.taskId, { reveal: true });
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setTaskCreateBusy(false);
        }
    }

    async function addDraftFile() {
        if (!taskDraftNewFile.trim()) return;
        await saveDraftFile(taskDraftNewFile.trim(), '');
        setTaskDraftNewFile('');
    }

    async function uploadDraftFiles(files: FileList | null) {
        if (!taskDraft || !validActor || !files || files.length === 0) return;
        setTaskCreateBusy(true);
        try {
            let latestSummary: TaskDraftSummary | null = null;
            for (const file of Array.from(files)) {
                const buffer = await file.arrayBuffer();
                latestSummary = await api<TaskDraftSummary>(`/api/drafts/tasks/${encodeURIComponent(taskDraft.draft.draftId)}/files/upload`, {
                    method: 'POST',
                    body: JSON.stringify({
                        path: file.name,
                        contentBase64: arrayBufferToBase64(buffer),
                    }),
                    actor,
                });
            }
            if (latestSummary) {
                setTaskDraft(latestSummary);
                setError(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setTaskCreateBusy(false);
        }
    }

    const content =
        view === 'dashboard' ? (
            <Dashboard
                t={t}
                counts={data?.status.counts ?? {}}
                runningTasks={runningTasks}
                failures={recentFailures}
                logs={data?.logs ?? []}
                process={data?.status ?? null}
                onSelectTask={taskId => {
                    selectTask(taskId, { reveal: true });
                    setView('tasks');
                }}
            />
        ) : view === 'tasks' ? (
            <TasksView
                t={t}
                formatDateTime={formatDateTimeLocal}
                tasks={filteredTasks}
                allTasks={data?.tasks ?? []}
                counts={data?.status.counts ?? {}}
                filter={filter}
                query={query}
                selectedTaskId={selectedTaskId}
                revealSelectedSeq={selectedTaskRevealSeq}
                details={taskDetails}
                runs={taskRuns}
                selectedRunId={selectedRunId}
                selectedRunDetails={selectedRunDetails}
                detailTab={detailTab}
                logText={logText}
                logStream={logStream}
                tailLogs={tailLogs}
                readOnly={readOnly}
                validActor={validActor}
                onFilter={setFilter}
                onQuery={setQuery}
                onSelectTask={taskId => selectTask(taskId)}
                onAction={runAction}
                onSelectRun={setSelectedRunId}
                onDetailTab={setDetailTab}
                onLogStream={setLogStream}
                onTailLogs={setTailLogs}
                fileArea={fileArea}
                files={taskFiles}
                selectedFile={selectedFile}
                fileText={fileText}
                onFileArea={setFileArea}
                onLoadFile={loadTaskFile}
            />
        ) : view === 'create-task' ? (
            <TaskCreateView
                t={t}
                validActor={validActor}
                readOnly={readOnly}
                options={taskCreateOptions}
                selectedType={taskCreateType}
                selectedMethod={taskCreateMethod}
                draft={taskDraft}
                selectedFile={taskDraftFile}
                fileText={taskDraftFileText}
                message={taskDraftMessage}
                title={taskDraftTitle}
                runner={taskDraftRunner}
                budgetUsd={taskDraftBudget}
                maxRetries={taskDraftMaxRetries}
                timeoutMs={taskDraftTimeoutMs}
                newFilePath={taskDraftNewFile}
                busy={taskCreateBusy}
                assistantBusy={taskDraftAssistantBusy}
                onType={setTaskCreateType}
                onMethod={value => setTaskCreateMethod(value as 'claude' | 'codex' | 'manual')}
                onCreateDraft={createTaskDraftWorkspace}
                onSelectFile={loadDraftFile}
                onFileText={setTaskDraftFileText}
                onSaveFile={() => saveDraftFile(taskDraftFile, taskDraftFileText)}
                onMessage={setTaskDraftMessage}
                onSendMessage={sendDraftMessage}
                onTitle={setTaskDraftTitle}
                onRunner={value => setTaskDraftRunner(value as 'claude' | 'codex')}
                onBudgetUsd={setTaskDraftBudget}
                onMaxRetries={setTaskDraftMaxRetries}
                onTimeoutMs={setTaskDraftTimeoutMs}
                onFinalize={finalizeTaskDraftWorkspace}
                onNewFilePath={setTaskDraftNewFile}
                onAddFile={addDraftFile}
                onUploadFiles={uploadDraftFiles}
            />
        ) : view === 'queue' ? (
            <QueueView t={t} formatDateTime={formatDateTimeLocal} queue={data?.queue} onSelectTask={taskId => { selectTask(taskId, { reveal: true }); setView('tasks'); }} />
        ) : view === 'schedules' ? (
            <SchedulesView
                t={t}
                schedules={data?.schedules ?? []}
                readOnly={readOnly}
                validActor={validActor}
                onAction={runScheduleAction}
            />
        ) : (
            <SettingsView
                t={t}
                language={language}
                actor={actor}
                actorDraft={actorDraft}
                autoRefresh={autoRefresh === 'true'}
                readOnly={readOnly}
                onLanguage={setLanguage}
                onActorDraft={setActorDraft}
                onSaveActor={() => setActor(actorDraft.trim())}
                onAutoRefresh={enabled => setAutoRefresh(String(enabled))}
                onClearHistory={clearTaskHistory}
                validActor={validActor}
            />
        );

    return (
        <>
            {!validActor && (
                <ActorModal
                    t={t}
                    draft={actorDraft}
                    onDraft={setActorDraft}
                    onSave={() => {
                        if (actorDraft.trim().length > 0 && actorDraft.trim().length <= 40) setActor(actorDraft.trim());
                    }}
                />
            )}
            <div className="shell">
                <aside className="nav">
                    <div className="brand">
                        <div className="brandMark">D</div>
                        <div>
                            <h1>Drift</h1>
                            <span>{t('workspace')}</span>
                        </div>
                    </div>
                    <nav>
                        <NavButton icon={<LayoutDashboard />} active={view === 'dashboard'} label={t('dashboard')} onClick={() => setView('dashboard')} />
                        <NavButton icon={<ListChecks />} active={view === 'tasks'} label={t('tasks')} onClick={() => setView('tasks')} />
                        <NavButton icon={<TerminalSquare />} active={view === 'queue'} label={t('queue')} onClick={() => setView('queue')} />
                        <NavButton icon={<Clock3 />} active={view === 'schedules'} label={t('schedules')} onClick={() => setView('schedules')} />
                        <NavButton icon={<Settings />} active={view === 'settings'} label={t('settings')} onClick={() => setView('settings')} />
                    </nav>
                    <div className="navFooter">
                        <StatusPill tone={readOnly ? 'muted' : 'ok'}>{readOnly ? t('readOnly') : t('writeEnabled')}</StatusPill>
                        <StatusPill tone={validActor ? 'info' : 'warn'}><UserRound size={13} />{validActor ? actor : t('userRequired')}</StatusPill>
                    </div>
                </aside>
                <main className="main">
                    <header className="topbar">
                        <div>
                            <h2>{t(view)}</h2>
                            {error && <p className="errorText">{error}</p>}
                        </div>
                        <div className="topActions">
                            {view === 'tasks' && (
                                <button className="primaryButton" onClick={() => openTaskCreate()}>
                                    <PlayCircle size={16} />
                                    {t('newTask')}
                                </button>
                            )}
                            <Segmented
                                value={language}
                                options={[{ value: 'en', label: 'EN' }, { value: 'zh', label: '中文' }]}
                                onChange={value => setLanguage(value as Language)}
                                fullWidth={false}
                            />
                            <button className="iconButton" onClick={() => loadAll()} title={t('refresh')}>
                                <RefreshCw size={17} />
                            </button>
                        </div>
                    </header>
                    {content}
                </main>
            </div>
        </>
    );
}

function Dashboard(props: {
    t: (key: string) => string;
    counts: Record<string, number>;
    runningTasks: TaskMetadata[];
    failures: TaskMetadata[];
    logs: string[];
    process: AppData['status'] | null;
    onSelectTask: (taskId: string) => void;
}) {
    const { t, counts, runningTasks, failures, logs, onSelectTask } = props;
    return (
        <div className="pageGrid">
            <div className="metricGrid wide">
                {(['pending', 'running', 'paused', 'blocked', 'done', 'not_queued'] as TaskStatus[]).map(status => (
                    <div className="metric" key={status}>
                        <span>{t(status)}</span>
                        <strong>{counts[status] ?? 0}</strong>
                    </div>
                ))}
            </div>
            <section className="panel dashboardPanel">
                <PanelTitle icon={<Activity />} title={t('currentRun')} />
                <TaskTable tasks={runningTasks} empty={t('empty')} onSelect={onSelectTask} t={t} />
            </section>
            <section className="panel dashboardPanel dashboardProcessPanel">
                <PanelTitle icon={<Zap />} title={t('process')} />
                <div className="infoGrid compact">
                    <Info label="Status" value={props.process?.running ? t('running') : t('paused')} />
                    <Info label={t('pid')} value={props.process?.pid ? String(props.process.pid) : '-'} />
                </div>
            </section>
            <section className="panel">
                <PanelTitle icon={<AlertTriangle />} title={t('recentFailures')} />
                <TaskTable tasks={failures} empty={t('empty')} onSelect={onSelectTask} t={t} />
            </section>
            <section className="panel wide">
                <PanelTitle icon={<TerminalSquare />} title={t('recentLog')} />
                <pre className="logBlock">{logs.length ? logs.join('\n') : t('noLogs')}</pre>
            </section>
        </div>
    );
}

function TasksView(props: {
    t: (key: string) => string;
    formatDateTime: (value?: string | null) => string;
    tasks: TaskMetadata[];
    allTasks: TaskMetadata[];
    counts: Record<string, number>;
    filter: TaskStatus | 'all';
    query: string;
    selectedTaskId: string | null;
    revealSelectedSeq: number;
    details: TaskDetails | null;
    runs: RunMeta[];
    selectedRunId: string | null;
    selectedRunDetails: TaskRunDetails | null;
    detailTab: DetailTab;
    logText: string;
    logStream: LogStream;
    tailLogs: boolean;
    readOnly: boolean;
    validActor: boolean;
    onFilter: (status: TaskStatus | 'all') => void;
    onQuery: (query: string) => void;
    onSelectTask: (taskId: string) => void;
    onAction: (action: 'enqueue' | 'resume' | 'rerun' | 'abandon' | 'cancel' | 'stop' | 'remove', taskId: string) => void;
    onSelectRun: (runId: string) => void;
    onDetailTab: (tab: DetailTab) => void;
    onLogStream: (stream: LogStream) => void;
    onTailLogs: (enabled: boolean) => void;
    fileArea: 'spec' | 'workdir';
    files: TaskFileEntry[];
    selectedFile: string;
    fileText: string;
    onFileArea: (area: 'spec' | 'workdir') => void;
    onLoadFile: (area: 'spec' | 'workdir', ref: string) => void;
}) {
    const { t, tasks, allTasks, counts, filter, query, selectedTaskId, details } = props;
    const taskListPaneRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!selectedTaskId) return;
        const pane = taskListPaneRef.current;
        if (!pane) return;
        const selectedCard = pane.querySelector<HTMLButtonElement>(`button[data-task-id="${selectedTaskId}"]`);
        if (!selectedCard) return;
        const paneRect = pane.getBoundingClientRect();
        const cardRect = selectedCard.getBoundingClientRect();
        const isVisible = cardRect.top >= paneRect.top && cardRect.bottom <= paneRect.bottom;
        if (!isVisible) {
            selectedCard.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }, [selectedTaskId, props.revealSelectedSeq]);

    return (
        <div className="tasksLayout">
            <section className="taskListPane" ref={taskListPaneRef}>
                <div className="searchBox">
                    <Search size={16} />
                    <input value={query} placeholder={t('search')} onChange={event => props.onQuery(event.target.value)} />
                </div>
                <div className="filterGrid">
                    {taskStatuses.map(status => (
                        <button
                            key={status}
                            className={filter === status ? 'active' : ''}
                            onClick={() => props.onFilter(status)}
                        >
                            <span>{t(status)}</span>
                            <strong>{status === 'all' ? allTasks.length : counts[status] ?? 0}</strong>
                        </button>
                    ))}
                </div>
                <div className="taskCards">
                    {tasks.map(task => (
                        <button
                            key={task.taskId}
                            data-task-id={task.taskId}
                            className={`taskCard ${selectedTaskId === task.taskId ? 'active' : ''}`}
                            onClick={() => props.onSelectTask(task.taskId)}
                        >
                            <span className="taskTitle">{task.title}</span>
                            <span className="taskMeta">{task.taskId}</span>
                            <span className="taskMeta"><Badge status={task.status} t={t} /> {task.type} · {task.runner}</span>
                        </button>
                    ))}
                    {tasks.length === 0 && <div className="emptyState">{t('empty')}</div>}
                </div>
            </section>
            <TaskDetail {...props} details={details} />
        </div>
    );
}

function TaskDetail(props: {
    t: (key: string) => string;
    formatDateTime: (value?: string | null) => string;
    details: TaskDetails | null;
    runs: RunMeta[];
    selectedRunId: string | null;
    selectedRunDetails: TaskRunDetails | null;
    detailTab: DetailTab;
    logText: string;
    logStream: LogStream;
    tailLogs: boolean;
    readOnly: boolean;
    validActor: boolean;
    onAction: (action: 'enqueue' | 'resume' | 'rerun' | 'abandon' | 'cancel' | 'stop' | 'remove', taskId: string) => void;
    onSelectRun: (runId: string) => void;
    onDetailTab: (tab: DetailTab) => void;
    onLogStream: (stream: LogStream) => void;
    onTailLogs: (enabled: boolean) => void;
    fileArea: 'spec' | 'workdir';
    files: TaskFileEntry[];
    selectedFile: string;
    fileText: string;
    onFileArea: (area: 'spec' | 'workdir') => void;
    onLoadFile: (area: 'spec' | 'workdir', ref: string) => void;
}) {
    const { t, details } = props;
    const logRef = useRef<HTMLPreElement | null>(null);
    const [logPinnedToBottom, setLogPinnedToBottom] = useState(true);

    useEffect(() => {
        if (!props.tailLogs) return;
        if (!logPinnedToBottom) return;
        const node = logRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [props.logText, props.tailLogs, logPinnedToBottom]);

    useEffect(() => {
        if (!props.tailLogs) return;
        const node = logRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
        setLogPinnedToBottom(true);
    }, [props.tailLogs, props.selectedRunId, props.logStream]);

    const syncLogScrollState = useCallback(() => {
        const node = logRef.current;
        if (!node) return;
        const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
        setLogPinnedToBottom(distanceFromBottom <= 24);
    }, []);

    function jumpLogToBottom() {
        const node = logRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
        setLogPinnedToBottom(true);
    }

    if (!details) return <section className="detailPane emptyDetail">{t('selectTask')}</section>;
    const { task, latestRun } = details;
    const runItems = [...props.runs].reverse();
    const actions: Array<['enqueue' | 'resume' | 'rerun' | 'abandon' | 'cancel' | 'stop' | 'remove', boolean]> = [
        ['enqueue', task.status === 'not_queued'],
        ['cancel', task.status === 'pending' || task.status === 'not_queued'],
        ['stop', task.status === 'running'],
        ['resume', task.status === 'paused'],
        ['rerun', task.status === 'done' || task.status === 'blocked'],
        ['abandon', task.status === 'paused'],
        ['remove', task.status !== 'running'],
    ];
    const selectedRunSummary = props.selectedRunDetails?.runMeta;
    const selectedRunResult = props.selectedRunDetails?.result;

    return (
        <section className="detailPane">
            <div className="detailHero">
                <div>
                    <h2>{task.title}</h2>
                    <div className="rowLine">
                        <Badge status={task.status} t={t} />
                        <span>{task.type}</span>
                        <span>{task.runner}</span>
                    </div>
                </div>
                <span className="mono">{task.taskId}</span>
            </div>
            <div className="actionRow">
                {actions.map(([action, enabled]) => (
                    <button
                        key={action}
                        className={action === 'abandon' || action === 'cancel' || action === 'stop' || action === 'remove' ? 'dangerButton' : 'primaryButton'}
                        disabled={!enabled || props.readOnly || !props.validActor}
                        onClick={() => props.onAction(action, task.taskId)}
                    >
                        {action === 'enqueue' && <PlayCircle size={16} />}
                        {action === 'resume' && <PlayCircle size={16} />}
                        {action === 'rerun' && <RotateCcw size={16} />}
                        {action === 'abandon' && <PauseCircle size={16} />}
                        {action === 'cancel' && <Trash2 size={16} />}
                        {action === 'stop' && <PauseCircle size={16} />}
                        {action === 'remove' && <Trash2 size={16} />}
                        {t(action)}
                    </button>
                ))}
            </div>
            <div className="infoGrid">
                <Info label={t('taskId')} value={task.taskId} />
                <Info label={t('queue')} value={details.queueStatus ? t(details.queueStatus) : '-'} />
                <Info label={t('retry')} value={`${task.retryCount}/${task.maxRetries}`} />
                <Info label={t('budget')} value={`$${task.budgetUsd}`} />
                <Info label={t('created')} value={props.formatDateTime(task.createdAt)} />
                <Info label={t('started')} value={props.formatDateTime(task.lastStartedAt)} />
                <Info label={t('finished')} value={props.formatDateTime(task.lastFinishedAt)} />
                <Info label={t('session')} value={latestRun?.runMeta?.sessionRef ?? '-'} />
            </div>
            <section className="panel flush detailTabsPanel">
                <Segmented
                    value={props.detailTab}
                    options={[
                        { value: 'overview', label: t('overview') },
                        { value: 'files', label: t('files') },
                        { value: 'runs', label: t('runsTitle') },
                        { value: 'logs', label: t('logs') },
                    ]}
                    onChange={value => props.onDetailTab(value as DetailTab)}
                    fullWidth
                />
            </section>
            {props.detailTab === 'overview' && (
                <section className="detailStack">
                    <section className="panel flush">
                        <PanelTitle icon={<Gauge />} title={t('latestActivity')} />
                        {latestRun ? (
                            <>
                                <div className="infoGrid compact">
                                    <Info label="Run" value={latestRun.runMeta?.runId ?? task.latestRunId ?? '-'} />
                                    <Info label="Status" value={latestRun.result?.status ?? latestRun.runMeta?.status ?? '-'} />
                                    <Info label={t('session')} value={latestRun.runMeta?.sessionRef ?? '-'} />
                                </div>
                                {(latestRun.result?.reason || latestRun.runMeta?.reason) && (
                                    <ReasonBlock label={t('reason')} value={latestRun.result?.reason ?? latestRun.runMeta?.reason ?? ''} />
                                )}
                                <h3>{t('artifacts')}</h3>
                                <ArtifactList taskId={task.taskId} artifacts={latestRun.artifacts} emptyText={t('noArtifacts')} downloadText={t('download')} />
                            </>
                        ) : (
                            <div className="emptyState">{t('empty')}</div>
                        )}
                    </section>
                </section>
            )}
            {props.detailTab === 'files' && (
                <section className="panel flush">
                    <PanelTitle icon={<ListChecks />} title={t('definition')} />
                    <div className="fileBrowser">
                        <div className="fileList">
                            <Segmented
                                value={props.fileArea}
                                options={[{ value: 'spec', label: t('spec') }, { value: 'workdir', label: t('workdir') }]}
                                onChange={value => props.onFileArea(value as 'spec' | 'workdir')}
                                fullWidth
                            />
                            <div className="fileRows">
                                {props.files.map(file => (
                                    <button
                                        key={file.path}
                                        disabled={file.kind === 'directory'}
                                        className={props.selectedFile === file.path ? 'active' : ''}
                                        onClick={() => props.onLoadFile(props.fileArea, file.path)}
                                    >
                                        <span>{file.path}</span>
                                        <small>{file.kind === 'directory' ? file.kind : `${file.size}b`}</small>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="filePreview">
                            <h3>{t('preview')}: {props.selectedFile}</h3>
                            <pre className="textPreview">{props.fileText || t('empty')}</pre>
                        </div>
                    </div>
                </section>
            )}
            {props.detailTab === 'runs' && (
                <section className="runWorkspace">
                    <section className="panel flush">
                        <PanelTitle icon={<Clock3 />} title={t('runsTitle')} />
                        <div className="runsList">
                            {runItems.length === 0 && <div className="emptyState">{t('empty')}</div>}
                            {runItems.map(run => (
                                <button
                                    className={`runRow ${props.selectedRunId === run.runId ? 'active' : ''}`}
                                    key={run.runId}
                                    onClick={() => props.onSelectRun(run.runId)}
                                >
                                    <span className="mono">{run.runId}</span>
                                    <span>{run.trigger}</span>
                                    <span>{run.status}</span>
                                    <span>{props.formatDateTime(run.startedAt)}</span>
                                </button>
                            ))}
                        </div>
                    </section>
                    <section className="panel flush">
                        <PanelTitle icon={<Gauge />} title={t('selectedRun')} />
                        {selectedRunSummary ? (
                            <>
                                <div className="infoGrid compact">
                                    <Info label="Run" value={selectedRunSummary.runId} />
                                    <Info label="Status" value={selectedRunResult?.status ?? selectedRunSummary.status ?? '-'} />
                                    <Info label={t('session')} value={selectedRunSummary.sessionRef ?? '-'} />
                                    <Info label={t('started')} value={props.formatDateTime(selectedRunSummary.startedAt)} />
                                    <Info label={t('finished')} value={props.formatDateTime(selectedRunSummary.finishedAt)} />
                                </div>
                                {(selectedRunResult?.reason || selectedRunSummary.reason) && (
                                    <ReasonBlock label={t('reason')} value={selectedRunResult?.reason ?? selectedRunSummary.reason ?? ''} />
                                )}
                                <h3>{t('artifacts')}</h3>
                                <ArtifactList
                                    taskId={task.taskId}
                                    artifacts={props.selectedRunDetails?.artifacts ?? []}
                                    emptyText={t('noArtifacts')}
                                    downloadText={t('download')}
                                />
                            </>
                        ) : (
                            <div className="emptyState">{t('noRunSelected')}</div>
                        )}
                    </section>
                </section>
            )}
            {props.detailTab === 'logs' && (
                <section className="panel flush">
                    <div className="panelHeader">
                        <PanelTitle icon={<TerminalSquare />} title={t('logViewer')} />
                        <div className="logToolbar">
                            <Segmented
                                value={props.logStream}
                                options={[{ value: 'stdout', label: t('stdout') }, { value: 'stderr', label: t('stderr') }]}
                                onChange={value => props.onLogStream(value as LogStream)}
                                fullWidth={false}
                            />
                            <button onClick={() => props.onTailLogs(!props.tailLogs)}>
                                {props.tailLogs ? t('stopFollowing') : t('startFollowing')}
                            </button>
                            {props.tailLogs && !logPinnedToBottom && (
                                <button onClick={jumpLogToBottom}>{t('jumpToBottom')}</button>
                            )}
                        </div>
                    </div>
                    <p className="mutedText logHint">
                        {t('followLogs')}: {props.tailLogs ? (logPinnedToBottom ? t('following') : t('viewingHistory')) : t('pausedLive')}
                    </p>
                    <div className="rowLine logMetaLine">
                        <span className="mono">{props.selectedRunId ?? '-'}</span>
                        <StatusPill tone="muted">{selectedRunResult?.status ?? selectedRunSummary?.status ?? '-'}</StatusPill>
                    </div>
                    <pre ref={logRef} className="logBlock" onScroll={syncLogScrollState}>
                        {props.selectedRunId ? props.logText || t('noLogs') : t('noRunSelected')}
                    </pre>
                </section>
            )}
        </section>
    );
}

function QueueView(props: {
    t: (key: string) => string;
    formatDateTime: (value?: string | null) => string;
    queue?: Record<QueueStatus, QueueItem[]>;
    onSelectTask: (taskId: string) => void;
}) {
    return (
        <div className="queueGrid">
            {queueStatuses.map(status => (
                <section className="panel queuePanel" key={status}>
                    <div className="panelHeader">
                        <PanelTitle icon={<TerminalSquare />} title={props.t(status)} />
                        <StatusPill tone="muted">{props.queue?.[status]?.length ?? 0}</StatusPill>
                    </div>
                    <div className="queueList">
                        {(props.queue?.[status] ?? []).map(item => (
                            <button className="queueRow" key={item.taskId} onClick={() => props.onSelectTask(item.taskId)}>
                                <span>{item.task.title}</span>
                                <span className="mono">{item.taskId}</span>
                                <span>{props.formatDateTime(item.enteredAt)}</span>
                            </button>
                        ))}
                        {(props.queue?.[status] ?? []).length === 0 && <div className="emptyState compactEmpty">{props.t('empty')}</div>}
                    </div>
                </section>
            ))}
        </div>
    );
}

function SchedulesView(props: {
    t: (key: string) => string;
    schedules: ScheduleItem[];
    readOnly: boolean;
    validActor: boolean;
    onAction: (action: 'enable' | 'disable' | 'run' | 'clear-tasks' | 'remove', scheduleId: string) => void;
}) {
    return (
        <div className="schedulesGrid">
            {props.schedules.map(item => (
                <section className="panel" key={item.schedule.scheduleId}>
                    <PanelTitle icon={<Clock3 />} title={item.schedule.scheduleId} />
                    <div className="rowLine">
                        <StatusPill tone={item.schedule.enabled ? 'ok' : 'muted'}>
                            {item.schedule.enabled ? props.t('enabled') : props.t('disabled')}
                        </StatusPill>
                        <span>{item.schedule.cron}</span>
                    </div>
                    <div className="infoGrid compact">
                        <Info label={props.t('type')} value={item.schedule.type} />
                        <Info label={props.t('runner')} value={item.schedule.runner} />
                        <Info label="skipIfActive" value={String(item.schedule.skipIfActive)} />
                        <Info label="lastTaskId" value={item.state?.lastTaskId ?? '-'} />
                        <Info label="lastRun" value={item.state?.lastRunStatus ?? '-'} />
                    </div>
                    <div className="actionRow">
                        <button
                            className="primaryButton"
                            disabled={props.readOnly || !props.validActor}
                            onClick={() => props.onAction(item.schedule.enabled ? 'disable' : 'enable', item.schedule.scheduleId)}
                        >
                            {item.schedule.enabled ? props.t('disable') : props.t('enable')}
                        </button>
                        <button className="primaryButton" disabled={props.readOnly || !props.validActor} onClick={() => props.onAction('run', item.schedule.scheduleId)}>
                            <Zap size={16} />
                            {props.t('runNow')}
                        </button>
                        <button className="dangerButton" disabled={props.readOnly || !props.validActor} onClick={() => props.onAction('clear-tasks', item.schedule.scheduleId)}>
                            <Trash2 size={16} />
                            {props.t('clearTasks')}
                        </button>
                        <button className="dangerButton" disabled={props.readOnly || !props.validActor} onClick={() => props.onAction('remove', item.schedule.scheduleId)}>
                            <Trash2 size={16} />
                            {props.t('removeSchedule')}
                        </button>
                    </div>
                </section>
            ))}
            {props.schedules.length === 0 && <section className="panel emptyState">{props.t('empty')}</section>}
        </div>
    );
}

function TaskCreateView(props: {
    t: (key: string) => string;
    validActor: boolean;
    readOnly: boolean;
    options: TaskCreateOptions | null;
    selectedType: string;
    selectedMethod: 'claude' | 'codex' | 'manual';
    draft: TaskDraftSummary | null;
    selectedFile: string;
    fileText: string;
    message: string;
    title: string;
    runner: 'claude' | 'codex';
    budgetUsd: string;
    maxRetries: string;
    timeoutMs: string;
    newFilePath: string;
    busy: boolean;
    assistantBusy: boolean;
    onType: (value: string) => void;
    onMethod: (value: string) => void;
    onCreateDraft: () => void;
    onSelectFile: (value: string) => void;
    onFileText: (value: string) => void;
    onSaveFile: () => void;
    onMessage: (value: string) => void;
    onSendMessage: () => void;
    onTitle: (value: string) => void;
    onRunner: (value: string) => void;
    onBudgetUsd: (value: string) => void;
    onMaxRetries: (value: string) => void;
    onTimeoutMs: (value: string) => void;
    onFinalize: (enqueue: boolean) => void;
    onNewFilePath: (value: string) => void;
    onAddFile: () => void;
    onUploadFiles: (files: FileList | null) => void;
}) {
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    const assistantThreadRef = useRef<HTMLDivElement | null>(null);
    const typeOptions = props.options?.taskTypes ?? [];
    const methodOptions =
        props.options?.creationMethods.map(method => ({
            value: method,
            label: method === 'manual' ? props.t('manual') : method,
        })) ?? [];
    const fileEntries = props.draft?.files.filter(file => file.kind === 'file') ?? [];
    const transcript = props.draft?.draft.transcript ?? [];
    const canFinalize = Boolean(props.draft?.taskMd.trim()) && props.title.trim().length > 0;

    useEffect(() => {
        const node = assistantThreadRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [transcript.length, props.assistantBusy]);

    return (
        <div className="createTaskLayout">
            <section className="panel">
                <PanelTitle icon={<ListChecks />} title={props.t('createTask')} />
                {!props.options ? (
                    <div className="emptyState">{props.t('loading')}</div>
                ) : (
                    <>
                        <div className="formGrid">
                            <label className="fieldBlock">
                                <span>{props.t('taskType')}</span>
                                <select value={props.selectedType} onChange={event => props.onType(event.target.value)}>
                                    {typeOptions.map(taskType => (
                                        <option key={taskType.type} value={taskType.type}>
                                            {taskType.label ?? taskType.type}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="fieldBlock">
                                <span>{props.t('creationMethod')}</span>
                                <Segmented value={props.selectedMethod} options={methodOptions} onChange={props.onMethod} fullWidth />
                            </label>
                        </div>
                            <button
                                className="primaryButton"
                                disabled={props.readOnly || !props.validActor || !props.selectedType || props.busy}
                                onClick={props.onCreateDraft}
                            >
                                <PlayCircle size={16} />
                                {props.t('createDraft')}
                            </button>
                    </>
                )}
            </section>

            {props.draft && (
                <div className={`createWorkbench ${props.draft.draft.creationMethod === 'manual' ? 'manualMode' : ''}`}>
                    <section className="panel flush">
                        <PanelTitle icon={<ListChecks />} title={props.t('draftFiles')} />
                        <div className="draftFileTools">
                            <input
                                value={props.newFilePath}
                                placeholder={props.t('newFilePath')}
                                onChange={event => props.onNewFilePath(event.target.value)}
                            />
                            <input
                                ref={uploadInputRef}
                                className="hiddenFileInput"
                                type="file"
                                multiple
                                onChange={event => {
                                    props.onUploadFiles(event.target.files);
                                    event.currentTarget.value = '';
                                }}
                            />
                            <div className="draftFileActions">
                                <button
                                    className="primaryButton"
                                    title={props.t('createEmptyFile')}
                                    disabled={props.readOnly || !props.validActor || props.busy}
                                    onClick={props.onAddFile}
                                >
                                    <FilePlus2 size={16} />
                                    {props.t('createEmptyFile')}
                                </button>
                                <button
                                    className="primaryButton secondaryButton"
                                    title={props.t('uploadFile')}
                                    disabled={props.readOnly || !props.validActor || props.busy}
                                    onClick={() => uploadInputRef.current?.click()}
                                >
                                    <Upload size={16} />
                                    {props.busy ? props.t('uploading') : props.t('uploadFile')}
                                </button>
                            </div>
                        </div>
                        <div className="fileRows">
                            {fileEntries.map(file => (
                                <button
                                    key={file.path}
                                    className={props.selectedFile === file.path ? 'active' : ''}
                                    onClick={() => props.onSelectFile(file.path)}
                                >
                                    <span>{file.path}</span>
                                    <small>{file.size}b</small>
                                </button>
                            ))}
                        </div>
                    </section>
                    <section className="panel flush">
                        <div className="panelHeader">
                            <PanelTitle icon={<TerminalSquare />} title={props.selectedFile} />
                            <button className="primaryButton" disabled={props.readOnly || !props.validActor || props.busy} onClick={props.onSaveFile}>
                                {props.t('saveFile')}
                            </button>
                        </div>
                        <textarea
                            className="draftEditor"
                            value={props.fileText}
                            onChange={event => props.onFileText(event.target.value)}
                            spellCheck={false}
                        />
                    </section>
                    {props.draft.draft.creationMethod !== 'manual' && (
                        <section className="panel flush">
                            <PanelTitle icon={<UserRound />} title={props.t('assistant')} />
                            <div className="assistantThread" ref={assistantThreadRef}>
                                {transcript.length === 0 && <div className="emptyState compactEmpty">{props.t('empty')}</div>}
                                {transcript.map((message, index) => (
                                    <div key={`${message.role}-${index}`} className={`assistantBubble ${message.role}`}>
                                        <strong>{message.role === 'user' ? 'You' : 'AI'}</strong>
                                        <pre>{normalizeDisplayText(message.content)}</pre>
                                    </div>
                                ))}
                                {props.assistantBusy && (
                                    <div className="assistantBubble assistantPending">
                                        <strong>AI</strong>
                                        <div className="assistantPendingLine">
                                            <span className="loadingDot" />
                                            <span>{props.t('assistantWorking')}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="assistantComposer">
                                <textarea
                                    value={props.message}
                                    placeholder={props.t('assistantPlaceholder')}
                                    onChange={event => props.onMessage(event.target.value)}
                                    disabled={props.assistantBusy}
                                />
                                <button
                                    className="primaryButton"
                                    disabled={
                                        props.readOnly ||
                                        !props.validActor ||
                                        props.busy ||
                                        props.assistantBusy ||
                                        props.message.trim().length === 0
                                    }
                                    onClick={props.onSendMessage}
                                >
                                    {props.assistantBusy ? props.t('assistantWorking') : props.t('send')}
                                </button>
                            </div>
                        </section>
                    )}
                    <section className="panel flush wide">
                        <PanelTitle icon={<Gauge />} title={props.t('createTask')} />
                        <div className="formGrid">
                            <label className="fieldBlock">
                                <span>Title</span>
                                <input value={props.title} onChange={event => props.onTitle(event.target.value)} />
                            </label>
                            <label className="fieldBlock">
                                <span>{props.t('runner')}</span>
                                <select value={props.runner} onChange={event => props.onRunner(event.target.value)}>
                                    {(props.options?.knownRunners ?? ['claude', 'codex']).map(runner => (
                                        <option key={runner} value={runner}>
                                            {runner}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="fieldBlock">
                                <span>{props.t('budget')}</span>
                                <input value={props.budgetUsd} onChange={event => props.onBudgetUsd(event.target.value)} />
                            </label>
                            <label className="fieldBlock">
                                <span>{props.t('retry')}</span>
                                <input value={props.maxRetries} onChange={event => props.onMaxRetries(event.target.value)} />
                            </label>
                            <label className="fieldBlock">
                                <span>Timeout (ms)</span>
                                <input value={props.timeoutMs} onChange={event => props.onTimeoutMs(event.target.value)} />
                            </label>
                        </div>
                        <div className="actionRow">
                            <button
                                className="primaryButton"
                                disabled={props.readOnly || !props.validActor || props.busy || !canFinalize}
                                onClick={() => props.onFinalize(false)}
                            >
                                {props.t('createAsDraft')}
                            </button>
                            <button
                                className="primaryButton"
                                disabled={props.readOnly || !props.validActor || props.busy || !canFinalize}
                                onClick={() => props.onFinalize(true)}
                            >
                                {props.t('createAndEnqueue')}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}

function SettingsView(props: {
    t: (key: string) => string;
    language: Language;
    actor: string;
    actorDraft: string;
    autoRefresh: boolean;
    readOnly: boolean;
    onLanguage: (language: Language) => void;
    onActorDraft: (value: string) => void;
    onSaveActor: () => void;
    onAutoRefresh: (enabled: boolean) => void;
    onClearHistory: () => void;
    validActor: boolean;
}) {
    return (
        <div className="settingsGrid">
            <section className="panel">
                <PanelTitle icon={<Globe2 />} title={props.t('language')} />
                <Segmented
                    value={props.language}
                    options={[{ value: 'en', label: 'EN' }, { value: 'zh', label: '中文' }]}
                    onChange={value => props.onLanguage(value as Language)}
                    fullWidth={false}
                />
            </section>
            <section className="panel">
                <PanelTitle icon={<UserRound />} title={props.t('displayName')} />
                <div className="settingRow">
                    <input value={props.actorDraft} onChange={event => props.onActorDraft(event.target.value)} maxLength={40} />
                    <button className="primaryButton" onClick={props.onSaveActor}>{props.t('save')}</button>
                </div>
                <p className="mutedText">{props.t('localOnly')}: {props.actor || '-'}</p>
            </section>
            <section className="panel">
                <PanelTitle icon={<RefreshCw />} title={props.t('autoRefresh')} />
                <label className="switchLine">
                    <input type="checkbox" checked={props.autoRefresh} onChange={event => props.onAutoRefresh(event.target.checked)} />
                    <span>10s</span>
                </label>
            </section>
            <section className="panel">
                <PanelTitle icon={<ShieldAlert />} title="Security" />
                <StatusPill tone={props.readOnly ? 'muted' : 'warn'}>{props.readOnly ? props.t('readOnly') : props.t('writeEnabled')}</StatusPill>
                <p className="mutedText">{props.t('lanNotice')}</p>
            </section>
            <section className="panel">
                <PanelTitle icon={<Trash2 />} title={props.t('clearHistory')} />
                <p className="mutedText">{props.t('clearHistoryBody')}</p>
                <button className="dangerButton" disabled={props.readOnly || !props.validActor} onClick={props.onClearHistory}>
                    <Trash2 size={16} />
                    {props.t('clearHistory')}
                </button>
            </section>
        </div>
    );
}

function ActorModal(props: { t: (key: string) => string; draft: string; onDraft: (value: string) => void; onSave: () => void }) {
    return (
        <div className="modal">
            <form className="dialog" onSubmit={event => { event.preventDefault(); props.onSave(); }}>
                <h2>{props.t('actorTitle')}</h2>
                <p>{props.t('actorBody')}</p>
                <input value={props.draft} autoFocus maxLength={40} onChange={event => props.onDraft(event.target.value)} />
                <button className="primaryButton" type="submit">{props.t('continue')}</button>
            </form>
        </div>
    );
}

function NavButton(props: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
    return <button className={`navButton ${props.active ? 'active' : ''}`} onClick={props.onClick}>{props.icon}<span>{props.label}</span></button>;
}

function PanelTitle(props: { icon: React.ReactNode; title: string }) {
    return <div className="panelTitle">{props.icon}<h3>{props.title}</h3></div>;
}

function TaskTable(props: { tasks: TaskMetadata[]; empty: string; t: (key: string) => string; onSelect: (taskId: string) => void }) {
    if (props.tasks.length === 0) return <div className="emptyState">{props.empty}</div>;
    return (
        <div className="taskTable">
            {props.tasks.map(task => (
                <button key={task.taskId} onClick={() => props.onSelect(task.taskId)}>
                    <span>{task.title}</span>
                    <Badge status={task.status} t={props.t} />
                    <span className="mono">{task.taskId}</span>
                </button>
            ))}
        </div>
    );
}

function Badge(props: { status: string; t: (key: string) => string }) {
    return <span className={`badge ${props.status}`}>{props.t(props.status)}</span>;
}

function StatusPill(props: { tone: 'ok' | 'warn' | 'muted' | 'info'; children: React.ReactNode }) {
    return <span className={`statusPill ${props.tone}`}>{props.children}</span>;
}

function Segmented(props: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    fullWidth?: boolean;
}) {
    return (
        <div className={`segmented ${props.fullWidth === false ? 'inline' : 'fullWidth'}`}>
            {props.options.map(option => (
                <button key={option.value} className={props.value === option.value ? 'active' : ''} onClick={() => props.onChange(option.value)}>
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function Info(props: { label: string; value: string }) {
    return <div className="infoItem"><span>{props.label}</span><strong>{props.value}</strong></div>;
}

function ReasonBlock(props: { label: string; value: string }) {
    return (
        <div className="detailNote">
            <span>{props.label}</span>
            <pre>{normalizeDisplayText(props.value)}</pre>
        </div>
    );
}

function ArtifactList(props: { taskId: string; artifacts: string[]; emptyText: string; downloadText: string }) {
    if (props.artifacts.length === 0) {
        return <pre className="artifactBlock">{props.emptyText}</pre>;
    }

    return (
        <div className="artifactList">
            {props.artifacts.map(artifact => (
                <a
                    key={artifact}
                    className="artifactRow"
                    href={`/api/tasks/${encodeURIComponent(props.taskId)}/artifacts/download?path=${encodeURIComponent(artifact)}`}
                >
                    <span>{artifact}</span>
                    <small>{props.downloadText}</small>
                </a>
            ))}
        </div>
    );
}

function formatDateTime(value: string | null | undefined, language: Language): string {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
    }).format(parsed);
}

function normalizeDisplayText(value: string): string {
    return value.replace(/\\n/g, '\n');
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function suggestTitleFromTaskMd(value: string): string {
    const lines = normalizeDisplayText(value)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return '';
    const firstHeading = lines.find(line => line.startsWith('#'));
    if (firstHeading) return firstHeading.replace(/^#+\s*/, '').slice(0, 80);
    return lines[0].slice(0, 80);
}

function useLocalStorage<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
    const [value, setValue] = useState<T>(() => (localStorage.getItem(key) as T | null) ?? fallback);
    const update = useCallback((next: T) => {
        localStorage.setItem(key, next);
        setValue(next);
    }, [key]);
    return [value, update];
}

async function api<T>(path: string, options: { method?: string; body?: string; actor?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body) headers['content-type'] = 'application/json';
    if (options.actor) headers['x-drift-user'] = options.actor;
    const res = await fetch(path, { method: options.method ?? 'GET', body: options.body, headers });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    return body as T;
}

async function apiText(path: string): Promise<string> {
    const res = await fetch(path);
    if (!res.ok) throw new Error(await res.text());
    return res.text();
}

createRoot(document.getElementById('root')!).render(<App />);
