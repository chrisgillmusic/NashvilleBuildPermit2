'use client';

import clsx from 'clsx';
import { format, formatDistanceToNowStrict, isAfter, parseISO, subDays } from 'date-fns';
import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '@/lib/format';
import { projectViewForMode, TRADE_OPTIONS, type FeedMode } from '@/lib/permits/trade-utils';
import type { ActiveContact, DashboardFilters, DashboardPayload, PermitProject } from '@/lib/permits/types';
import { PermitFeedCard } from './permit-feed-card';

type Props = {
  initialPayload: DashboardPayload;
  initialTab?: 'home' | 'jobs' | 'builders' | 'contractors' | 'profile';
};

type TabKey = 'jobs' | 'contractors' | 'profile';
type TimeframeKey = 'new' | 'active' | 'older';

type UserProfile = {
  email: string;
  username: string;
  businessName: string;
  phone: string;
  trade: string;
  budgetMin: number;
  budgetMax: number;
  defaultFeedMode: FeedMode;
};

type VisibleGenerationProgress = {
  totalVisible: number;
  storedBefore: number;
  needed: number;
  processed: number;
  succeeded: number;
  failed: number;
  batchIndex: number;
  batchCount: number;
  actionLabel: string;
  status: 'idle' | 'running' | 'complete' | 'failed';
};

const PROFILE_KEY = 'nbi-profile-v1';
const ONBOARDING_KEY = 'nbi-onboarding-complete-v1';
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'Version 13 • Summary First';
const VISIBLE_SUMMARY_CHUNK_SIZE = 5;

const ONBOARDING_CARDS = [
  'BidHammer scans live permit data to surface real construction opportunities.',
  'Choose your trade to put the most relevant jobs at the top of your scroll.',
  'Call active contractors directly when permit records include contact information.',
  'Stay on top of new Nashville jobs before someone else gets there first.'
] as const;

const MOBILE_TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'jobs', label: 'Jobs' },
  { key: 'contractors', label: 'Contractors' },
  { key: 'profile', label: 'Profile' }
];

function normalizeInitialTab(initialTab?: Props['initialTab']): TabKey {
  if (initialTab === 'profile') return 'profile';
  if (initialTab === 'builders' || initialTab === 'contractors') return 'contractors';
  return 'jobs';
}

function buildQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams({
    minBudget: String(filters.minBudget),
    maxBudget: String(filters.maxBudget),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    sort: filters.sort
  });

  if (filters.permitType) params.set('permitType', filters.permitType);
  if (filters.neighborhood) params.set('neighborhood', filters.neighborhood);
  if (filters.contractorQuery) params.set('contractorQuery', filters.contractorQuery);

  return params.toString();
}

function aggregateContacts(projects: PermitProject[]): ActiveContact[] {
  const map = new Map<string, ActiveContact>();

  for (const project of projects) {
    if (!project.contactName || project.contactName === 'Contact not listed') continue;

    const existing = map.get(project.contactName);
    if (!existing) {
      map.set(project.contactName, {
        name: project.contactName,
        projectCount: 1,
        totalValuation: project.valuation,
        mostRecentPermit: project.issueDate,
        phone: project.contactPhone,
        email: project.contactEmail
      });
      continue;
    }

    existing.projectCount += 1;
    existing.totalValuation += project.valuation;
    if (project.issueDate > existing.mostRecentPermit) existing.mostRecentPermit = project.issueDate;
    if (!existing.phone && project.contactPhone) existing.phone = project.contactPhone;
    if (!existing.email && project.contactEmail) existing.email = project.contactEmail;
  }

  return [...map.values()].sort((left, right) => right.projectCount - left.projectCount || right.totalValuation - left.totalValuation);
}

function formatPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function getInitialProfile(payload: DashboardPayload): UserProfile {
  return {
    email: '',
    username: '',
    businessName: '',
    phone: '',
    trade: '',
    budgetMin: payload.filters.minBudget,
    budgetMax: payload.filters.maxBudget,
    defaultFeedMode: 'my-trade'
  };
}

function projectsForTimeframe(projects: PermitProject[], timeframe: TimeframeKey): PermitProject[] {
  const now = new Date();

  if (timeframe === 'new') {
    return projects.filter((project) => isAfter(parseISO(project.issueDate), subDays(now, 7)));
  }

  if (timeframe === 'active') {
    return projects.filter((project) => {
      const issued = parseISO(project.issueDate);
      return isAfter(issued, subDays(now, 30)) && !isAfter(issued, subDays(now, 7));
    });
  }

  return projects.filter((project) => !isAfter(parseISO(project.issueDate), subDays(now, 30)));
}

function buildHeaderSummary(trade: string): string {
  const label = trade || 'Drywall';
  return `${label} looks slow this week. Interior build-outs are carrying volume.`;
}

function sectionLabel(key: TimeframeKey): { title: string; subtitle: string } {
  if (key === 'new') return { title: 'Top Jobs', subtitle: '(this week)' };
  if (key === 'active') return { title: 'Jobs In Progress', subtitle: '(this month)' };
  return { title: 'Earlier Jobs', subtitle: '(older than 30 days)' };
}

export function DashboardShell({ initialPayload, initialTab = 'jobs' }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => normalizeInitialTab(initialTab));
  const [filters, setFilters] = useState<DashboardFilters>(initialPayload.filters);
  const [payload, setPayload] = useState<DashboardPayload>(initialPayload);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => getInitialProfile(initialPayload));
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [debugProjectId, setDebugProjectId] = useState('24468');
  const [debugBypassCache, setDebugBypassCache] = useState(true);
  const [regenerateStatus, setRegenerateStatus] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGeneratingVisibleAi, setIsGeneratingVisibleAi] = useState(false);
  const [isRegeneratingVisibleAi, setIsRegeneratingVisibleAi] = useState(false);
  const [isGeneratingTradeNote, setIsGeneratingTradeNote] = useState(false);
  const [isGeneratingVisibleTradeNotes, setIsGeneratingVisibleTradeNotes] = useState(false);
  const [visibleGenerationProgress, setVisibleGenerationProgress] = useState<VisibleGenerationProgress | null>(null);
  const [logoFallback, setLogoFallback] = useState(false);
  const onboardingTrackRef = useRef<HTMLDivElement | null>(null);

  const requestQuery = useMemo(() => {
    const params = new URLSearchParams(buildQuery(filters));
    if (profile.trade) params.set('trade', profile.trade);
    return params.toString();
  }, [filters, profile.trade]);

  useEffect(() => {
    const storedProfile = window.localStorage.getItem(PROFILE_KEY);
    if (storedProfile) {
      const parsed = JSON.parse(storedProfile) as Partial<UserProfile>;
      const merged = { ...getInitialProfile(initialPayload), ...parsed };
      setProfile(merged);
      setFilters((current) => ({
        ...current,
        minBudget: merged.budgetMin ?? current.minBudget,
        maxBudget: merged.budgetMax ?? current.maxBudget
      }));
    }

    const onboardingComplete = window.localStorage.getItem(ONBOARDING_KEY) === 'true';
    setShowOnboarding(!onboardingComplete);
    setOnboardingReady(true);
  }, [initialPayload]);

  useEffect(() => {
    if (!onboardingReady) return;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [onboardingReady, profile]);

  const visibleProjects = useMemo(() => {
    if (profile.defaultFeedMode === 'my-trade' && profile.trade) {
      return projectViewForMode(payload.projects, 'my-trade', profile.trade);
    }
    return payload.projects;
  }, [payload.projects, profile.defaultFeedMode, profile.trade]);

  const feedSections = useMemo(
    () => [
      { key: 'new' as const, ...sectionLabel('new'), projects: projectsForTimeframe(visibleProjects, 'new') },
      {
        key: 'active' as const,
        ...sectionLabel('active'),
        projects: projectsForTimeframe(visibleProjects, 'active')
      },
      { key: 'older' as const, ...sectionLabel('older'), projects: projectsForTimeframe(visibleProjects, 'older') }
    ],
    [visibleProjects]
  );

  const contractors = useMemo(() => aggregateContacts(visibleProjects), [visibleProjects]);
  const visibleStoredCount = useMemo(() => visibleProjects.filter((project) => project.summarySource === 'ai').length, [visibleProjects]);
  const visibleNeedsSummaryCount = useMemo(() => visibleProjects.filter((project) => project.needsSummary).length, [visibleProjects]);
  const visibleNeedsTradeNoteCount = useMemo(
    () => (profile.trade ? visibleProjects.filter((project) => project.needsTradeNote || project.needsTradeNoteRefresh).length : 0),
    [profile.trade, visibleProjects]
  );
  const visibleNeedsRefreshCount = useMemo(
    () => visibleProjects.filter((project) => project.needsSummaryRefresh || project.needsTradeNoteRefresh).length,
    [visibleProjects]
  );

  function updateProfile<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function applyProfileBudget() {
    setFilters((current) => ({
      ...current,
      minBudget: profile.budgetMin,
      maxBudget: profile.budgetMax
    }));
  }

  function completeOnboarding() {
    if (!profile.trade) return;
    window.localStorage.setItem(ONBOARDING_KEY, 'true');
    setShowOnboarding(false);
  }

  function advanceOnboarding() {
    const nextIndex = Math.min(onboardingIndex + 1, ONBOARDING_CARDS.length - 1);
    setOnboardingIndex(nextIndex);
    onboardingTrackRef.current?.children[nextIndex]?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
  }

  async function refreshPayload() {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/permits?${requestQuery}`, {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error('Failed to refresh permits');
      }

      const nextPayload = (await response.json()) as DashboardPayload;
      startTransition(() => setPayload(nextPayload));
      return nextPayload;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRegenerate() {
    const id = debugProjectId.trim();
    if (!id) return;

    setIsRegenerating(true);
    setRegenerateStatus(null);

    try {
      const response = await fetch('/api/permits/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, trade: profile.trade, bypassCache: debugBypassCache })
      });

      if (!response.ok) throw new Error('Failed to regenerate AI interpretation');

      const result = (await response.json()) as { project: PermitProject | null; debug: DashboardPayload['debug'] };
      if (!result.project) {
        setRegenerateStatus('Project not found.');
        return;
      }

      await refreshPayload();
      startTransition(() =>
        setPayload((current) => ({
          ...current,
          debug: result.debug
        }))
      );
      setRegenerateStatus(`Regenerated project ${result.project.address || result.project.id}.`);
    } catch (error) {
      setRegenerateStatus((error as Error).message);
    } finally {
      setIsRegenerating(false);
    }
  }

  async function handleGenerateTradeNote() {
    const id = debugProjectId.trim();
    if (!id || !profile.trade) return;

    setIsGeneratingTradeNote(true);
    setRegenerateStatus(null);

    try {
      const response = await fetch('/api/permits/generate-trade-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, trade: profile.trade, bypassCache: debugBypassCache })
      });

      if (!response.ok) throw new Error('Failed to generate trade note');

      const result = (await response.json()) as { project: PermitProject | null; debug: DashboardPayload['debug'] };
      if (!result.project) {
        setRegenerateStatus('Project not found.');
        return;
      }

      await refreshPayload();
      startTransition(() =>
        setPayload((current) => ({
          ...current,
          debug: result.debug
        }))
      );
      setRegenerateStatus(`Generated trade note for ${result.project.address || result.project.id}.`);
    } catch (error) {
      setRegenerateStatus((error as Error).message);
    } finally {
      setIsGeneratingTradeNote(false);
    }
  }

  async function handleGenerateVisibleTradeNotes() {
    if (!profile.trade) {
      setRegenerateStatus('Select a trade before generating visible trade notes.');
      return;
    }

    if (!visibleProjects.length) {
      setRegenerateStatus('No visible jobs to generate trade notes for.');
      return;
    }

    const idsNeedingTradeNotes = visibleProjects
      .filter((project) => project.needsTradeNote || project.needsTradeNoteRefresh)
      .map((project) => project.id);
    const storedBefore = visibleProjects.length - idsNeedingTradeNotes.length;

    if (!idsNeedingTradeNotes.length) {
      setVisibleGenerationProgress({
        totalVisible: visibleProjects.length,
        storedBefore,
        needed: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        batchIndex: 0,
        batchCount: 0,
        actionLabel: 'Generate trade notes',
        status: 'complete'
      });
      setRegenerateStatus('All visible jobs already have current trade notes for this trade.');
      return;
    }

    const batches = Array.from({ length: Math.ceil(idsNeedingTradeNotes.length / VISIBLE_SUMMARY_CHUNK_SIZE) }, (_, index) =>
      idsNeedingTradeNotes.slice(index * VISIBLE_SUMMARY_CHUNK_SIZE, index * VISIBLE_SUMMARY_CHUNK_SIZE + VISIBLE_SUMMARY_CHUNK_SIZE)
    );

    setIsGeneratingVisibleTradeNotes(true);
    setRegenerateStatus(null);
    setVisibleGenerationProgress({
      totalVisible: visibleProjects.length,
      storedBefore,
      needed: idsNeedingTradeNotes.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      batchIndex: 0,
      batchCount: batches.length,
      actionLabel: 'Generate trade notes',
      status: 'running'
    });

    try {
      let generatedCount = 0;
      let failedCount = 0;
      let latestDebug: DashboardPayload['debug'] | null = null;

      for (const [batchIndex, ids] of batches.entries()) {
        const response = await fetch('/api/permits/generate-trade-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids,
            trade: profile.trade,
            bypassCache: false
          })
        });

        if (!response.ok) throw new Error(`Failed to generate visible trade notes in batch ${batchIndex + 1}`);

        const result = (await response.json()) as {
          results: Array<{ id: string; tradeSource: 'ai' | 'fallback'; cacheStatus: string }>;
          debug: DashboardPayload['debug'];
        };

        latestDebug = result.debug;
        generatedCount += result.results.filter((entry) => entry.tradeSource === 'ai').length;
        failedCount += result.results.filter((entry) => entry.tradeSource !== 'ai').length;

        setVisibleGenerationProgress({
          totalVisible: visibleProjects.length,
          storedBefore,
          needed: idsNeedingTradeNotes.length,
          processed: Math.min((batchIndex + 1) * VISIBLE_SUMMARY_CHUNK_SIZE, idsNeedingTradeNotes.length),
          succeeded: generatedCount,
          failed: failedCount,
          batchIndex: batchIndex + 1,
          batchCount: batches.length,
          actionLabel: 'Generate trade notes',
          status: 'running'
        });
      }

      const overallMessage = `Generated trade notes for ${generatedCount} of ${idsNeedingTradeNotes.length} visible jobs.${failedCount ? ` ${failedCount} stayed on fallback.` : ''}`;
      const nextPayload = await refreshPayload();
      startTransition(() =>
        setPayload({
          ...nextPayload,
          debug: {
            ...(latestDebug || nextPayload.debug),
            lastGenerateActionResult: overallMessage
          }
        })
      );
      setVisibleGenerationProgress({
        totalVisible: visibleProjects.length,
        storedBefore,
        needed: idsNeedingTradeNotes.length,
        processed: idsNeedingTradeNotes.length,
        succeeded: generatedCount,
        failed: failedCount,
        batchIndex: batches.length,
        batchCount: batches.length,
        actionLabel: 'Generate trade notes',
        status: 'complete'
      });
      setRegenerateStatus(overallMessage);
    } catch (error) {
      setVisibleGenerationProgress((current) =>
        current
          ? {
              ...current,
              status: 'failed'
            }
          : null
      );
      setRegenerateStatus((error as Error).message);
    } finally {
      setIsGeneratingVisibleTradeNotes(false);
    }
  }

  async function handleGenerateVisibleAi() {
    if (!visibleProjects.length) {
      setRegenerateStatus('No visible jobs to generate.');
      return;
    }

    const idsNeedingSummary = visibleProjects.filter((project) => project.needsSummary).map((project) => project.id);
    const storedBefore = visibleProjects.length - idsNeedingSummary.length;

    if (!idsNeedingSummary.length) {
      setVisibleGenerationProgress({
        totalVisible: visibleProjects.length,
        storedBefore,
        needed: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        batchIndex: 0,
        batchCount: 0,
        actionLabel: 'Generate summaries',
        status: 'complete'
      });
      setRegenerateStatus('All visible jobs already have stored summaries.');
      return;
    }

    const batches = Array.from({ length: Math.ceil(idsNeedingSummary.length / VISIBLE_SUMMARY_CHUNK_SIZE) }, (_, index) =>
      idsNeedingSummary.slice(index * VISIBLE_SUMMARY_CHUNK_SIZE, index * VISIBLE_SUMMARY_CHUNK_SIZE + VISIBLE_SUMMARY_CHUNK_SIZE)
    );

    setIsGeneratingVisibleAi(true);
    setRegenerateStatus(null);
    setVisibleGenerationProgress({
      totalVisible: visibleProjects.length,
      storedBefore,
      needed: idsNeedingSummary.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      batchIndex: 0,
      batchCount: batches.length,
      actionLabel: 'Generate summaries',
      status: 'running'
    });

    try {
      let generatedCount = 0;
      let failedCount = 0;
      let latestDebug: DashboardPayload['debug'] | null = null;

      for (const [batchIndex, ids] of batches.entries()) {
        const response = await fetch('/api/permits/generate-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids,
            trade: profile.trade,
            bypassCache: false
          })
        });

        if (!response.ok) throw new Error(`Failed to generate AI for visible jobs in batch ${batchIndex + 1}`);

        const result = (await response.json()) as {
          results: Array<{ id: string; summarySource: 'ai' | 'fallback'; cacheStatus: string }>;
          debug: DashboardPayload['debug'];
        };

        latestDebug = result.debug;
        generatedCount += result.results.filter((entry) => entry.summarySource === 'ai').length;
        failedCount += result.results.filter((entry) => entry.summarySource !== 'ai').length;

        setVisibleGenerationProgress({
          totalVisible: visibleProjects.length,
          storedBefore,
          needed: idsNeedingSummary.length,
          processed: Math.min((batchIndex + 1) * VISIBLE_SUMMARY_CHUNK_SIZE, idsNeedingSummary.length),
          succeeded: generatedCount,
          failed: failedCount,
          batchIndex: batchIndex + 1,
          batchCount: batches.length,
          actionLabel: 'Generate summaries',
          status: 'running'
        });
      }

      const overallMessage = `Stored summaries for ${generatedCount} of ${idsNeedingSummary.length} visible jobs.${failedCount ? ` ${failedCount} stayed on fallback.` : ''}`;
      const nextPayload = await refreshPayload();
      startTransition(() =>
        setPayload({
          ...nextPayload,
          debug: {
            ...(latestDebug || nextPayload.debug),
            lastGenerateActionResult: overallMessage
          }
        })
      );
      setVisibleGenerationProgress({
        totalVisible: visibleProjects.length,
        storedBefore,
        needed: idsNeedingSummary.length,
        processed: idsNeedingSummary.length,
        succeeded: generatedCount,
        failed: failedCount,
        batchIndex: batches.length,
        batchCount: batches.length,
        actionLabel: 'Generate summaries',
        status: 'complete'
      });
      setRegenerateStatus(overallMessage);
    } catch (error) {
      setVisibleGenerationProgress((current) =>
        current
          ? {
              ...current,
              status: 'failed'
            }
          : null
      );
      setRegenerateStatus((error as Error).message);
    } finally {
      setIsGeneratingVisibleAi(false);
    }
  }

  async function handleRegenerateVisibleAi() {
    if (!visibleProjects.length) {
      setRegenerateStatus('No visible jobs to regenerate.');
      return;
    }

    const idsNeedingRefresh = visibleProjects
      .filter(
        (project) =>
          project.needsSummary ||
          project.needsTradeNote ||
          project.needsSummaryRefresh ||
          project.needsTradeNoteRefresh
      )
      .map((project) => project.id);
    const storedBefore = visibleProjects.length - idsNeedingRefresh.length;

    if (!idsNeedingRefresh.length) {
      setVisibleGenerationProgress({
        totalVisible: visibleProjects.length,
        storedBefore,
        needed: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        batchIndex: 0,
        batchCount: 0,
        actionLabel: 'Regenerate content',
        status: 'complete'
      });
      setRegenerateStatus('Visible content is already current for this view.');
      return;
    }

    const batches = Array.from({ length: Math.ceil(idsNeedingRefresh.length / VISIBLE_SUMMARY_CHUNK_SIZE) }, (_, index) =>
      idsNeedingRefresh.slice(index * VISIBLE_SUMMARY_CHUNK_SIZE, index * VISIBLE_SUMMARY_CHUNK_SIZE + VISIBLE_SUMMARY_CHUNK_SIZE)
    );

    setIsRegeneratingVisibleAi(true);
    setRegenerateStatus(null);
    setVisibleGenerationProgress({
      totalVisible: visibleProjects.length,
      storedBefore,
      needed: idsNeedingRefresh.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      batchIndex: 0,
      batchCount: batches.length,
      actionLabel: 'Regenerate content',
      status: 'running'
    });

    try {
      let generatedCount = 0;
      let failedCount = 0;
      let latestDebug: DashboardPayload['debug'] | null = null;

      for (const [batchIndex, ids] of batches.entries()) {
        const response = await fetch('/api/permits/generate-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids,
            trade: profile.trade,
            bypassCache: true,
            regenerateTradeNotes: Boolean(profile.trade)
          })
        });

        if (!response.ok) throw new Error(`Failed to regenerate visible content in batch ${batchIndex + 1}`);

        const result = (await response.json()) as {
          results: Array<{ id: string; summarySource: 'ai' | 'fallback'; cacheStatus: string }>;
          debug: DashboardPayload['debug'];
        };

        latestDebug = result.debug;
        generatedCount += result.results.filter((entry) => entry.summarySource === 'ai').length;
        failedCount += result.results.filter((entry) => entry.summarySource !== 'ai').length;

        setVisibleGenerationProgress({
          totalVisible: visibleProjects.length,
          storedBefore,
          needed: idsNeedingRefresh.length,
          processed: Math.min((batchIndex + 1) * VISIBLE_SUMMARY_CHUNK_SIZE, idsNeedingRefresh.length),
          succeeded: generatedCount,
          failed: failedCount,
          batchIndex: batchIndex + 1,
          batchCount: batches.length,
          actionLabel: 'Regenerate content',
          status: 'running'
        });
      }

      const overallMessage = `Regenerated content for ${generatedCount} of ${idsNeedingRefresh.length} visible jobs.${failedCount ? ` ${failedCount} stayed on fallback.` : ''}`;
      const nextPayload = await refreshPayload();
      startTransition(() =>
        setPayload({
          ...nextPayload,
          debug: {
            ...(latestDebug || nextPayload.debug),
            lastRegenerateActionResult: overallMessage
          }
        })
      );
      setVisibleGenerationProgress({
        totalVisible: visibleProjects.length,
        storedBefore,
        needed: idsNeedingRefresh.length,
        processed: idsNeedingRefresh.length,
        succeeded: generatedCount,
        failed: failedCount,
        batchIndex: batches.length,
        batchCount: batches.length,
        actionLabel: 'Regenerate content',
        status: 'complete'
      });
      setRegenerateStatus(overallMessage);
    } catch (error) {
      setVisibleGenerationProgress((current) =>
        current
          ? {
              ...current,
              status: 'failed'
            }
          : null
      );
      setRegenerateStatus((error as Error).message);
    } finally {
      setIsRegeneratingVisibleAi(false);
    }
  }

  return (
    <>
      <main className="mx-auto min-h-screen w-full max-w-5xl px-4 pb-32 pt-4 sm:px-6">
        {activeTab === 'jobs' ? (
          <section>
            <header className="px-1 pb-8 pt-3">
              <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-5">
                <div>
                  <div className="text-4xl font-semibold tracking-[-0.04em] text-[#f5f5f7]">{format(new Date(), 'MMMM d')}</div>
                  <p className="mt-3 max-w-[15.5rem] text-sm leading-6 text-[#b3b3b8] sm:max-w-[19rem]">{buildHeaderSummary(profile.trade)}</p>
                </div>
                <div className="flex flex-col items-end pt-1">
                  {logoFallback ? (
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-[0.32em] text-[#8e8e93]">BidHammer</div>
                    </div>
                  ) : (
                    <img
                      src="/brand/bh-logo.png"
                      alt="BidHammer"
                      width={132}
                      height={46}
                      className="h-auto w-[118px] object-contain sm:w-[132px]"
                      onError={() => setLogoFallback(true)}
                    />
                  )}
                </div>
              </div>
            </header>

            <div className="space-y-10">
              {feedSections.map((section) => (
                <section key={section.key} className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h2 className="text-2xl font-semibold text-[#ff3b30]">{section.title}</h2>
                        <p className="text-sm text-[#8e8e93]">{section.subtitle}</p>
                      </div>
                      <div className="text-xs uppercase tracking-[0.2em] text-[#636366]">{section.projects.length} jobs</div>
                    </div>
                  </div>

                  {section.projects.length ? (
                    <div className="space-y-4">
                      {section.projects.map((project) => (
                        <PermitFeedCard
                          key={project.id}
                          project={project}
                          trade={profile.trade}
                          expanded={expandedJobId === project.id}
                          onToggle={() => setExpandedJobId((current) => (current === project.id ? null : project.id))}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-white/8 bg-[#111113] px-5 py-8 text-sm text-[#8e8e93]">
                      No jobs in this section yet.
                    </div>
                  )}
                </section>
              ))}
            </div>
          </section>
        ) : null}

        {activeTab === 'contractors' ? (
          <section className="space-y-4 pt-2">
            <div className="flex items-end justify-between gap-4 border-b border-[#ff3b30]/35 pb-4">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-[#8e8e93]">Contractors</div>
                <h1 className="mt-2 text-3xl font-semibold text-[#f5f5f7]">Call the names showing up on live permits.</h1>
              </div>
              <div className="text-sm text-[#8e8e93]">{contractors.length} contacts</div>
            </div>

            <p className="text-xs text-[#636366]">Where available, contact information is provided directly from permit records.</p>

            <div className="space-y-4">
              {contractors.map((contact) => (
                <article key={contact.name} className="rounded-[26px] border border-white/8 bg-[#1c1c1e] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.38)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-[#f5f5f7]">{contact.name}</h2>
                      <p className="mt-2 text-sm text-[#b3b3b8]">
                        {contact.projectCount} projects • {formatCurrency(contact.totalValuation)}
                      </p>
                      {contact.phone ? <p className="mt-3 text-sm text-[#d8d8dc]">{contact.phone}</p> : null}
                      {contact.email ? <p className="mt-1 text-sm text-[#d8d8dc]">{contact.email}</p> : null}
                      {!contact.phone && !contact.email ? <p className="mt-3 text-sm text-[#8e8e93]">Contact info unavailable</p> : null}
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-[#111113] px-4 py-3 text-right">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-[#8e8e93]">Most recent</div>
                      <div className="mt-2 text-sm text-[#f5f5f7]">{formatDistanceToNowStrict(parseISO(contact.mostRecentPermit), { addSuffix: true })}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    {contact.phone ? (
                      <a href={formatPhoneHref(contact.phone)} className="rounded-full bg-[#ff3b30] px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]">
                        Call
                      </a>
                    ) : null}
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-[#f5f5f7] active:scale-[0.98]">
                        Email
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeTab === 'profile' ? (
          <section className="space-y-4 pt-2">
            <div className="border-b border-[#ff3b30]/35 pb-4">
              <div className="text-xs uppercase tracking-[0.28em] text-[#8e8e93]">Profile</div>
              <h1 className="mt-2 text-3xl font-semibold text-[#f5f5f7]">Set your trade and keep the feed tuned to your work.</h1>
            </div>

            <div className="rounded-[28px] border border-white/8 bg-[#1c1c1e] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.38)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2 text-sm text-[#d8d8dc]">
                  <span>Email</span>
                  <input value={profile.email} onChange={(event) => updateProfile('email', event.target.value)} type="email" className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-[#f5f5f7] outline-none transition focus:border-[#ff3b30]" />
                </label>
                <label className="space-y-2 text-sm text-[#d8d8dc]">
                  <span>Username</span>
                  <input value={profile.username} onChange={(event) => updateProfile('username', event.target.value)} type="text" className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-[#f5f5f7] outline-none transition focus:border-[#ff3b30]" />
                </label>
                <label className="space-y-2 text-sm text-[#d8d8dc]">
                  <span>Business name</span>
                  <input value={profile.businessName} onChange={(event) => updateProfile('businessName', event.target.value)} type="text" className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-[#f5f5f7] outline-none transition focus:border-[#ff3b30]" />
                </label>
                <label className="space-y-2 text-sm text-[#d8d8dc]">
                  <span>Phone</span>
                  <input value={profile.phone} onChange={(event) => updateProfile('phone', event.target.value)} type="tel" className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-[#f5f5f7] outline-none transition focus:border-[#ff3b30]" />
                </label>
                <label className="space-y-2 text-sm text-[#d8d8dc]">
                  <span>Selected trade</span>
                  <select value={profile.trade} onChange={(event) => updateProfile('trade', event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-[#f5f5f7] outline-none transition focus:border-[#ff3b30]">
                    <option value="">Select your trade</option>
                    {TRADE_OPTIONS.map((trade) => (
                      <option key={trade} value={trade}>
                        {trade}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm text-[#d8d8dc]">
                  <span>Default feed scope</span>
                  <select value={profile.defaultFeedMode} onChange={(event) => updateProfile('defaultFeedMode', event.target.value as FeedMode)} className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-[#f5f5f7] outline-none transition focus:border-[#ff3b30]">
                    <option value="my-trade">My Trade</option>
                    <option value="all-jobs">All Jobs</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="space-y-2 text-sm text-[#d8d8dc]">
                  <span>Budget min</span>
                  <input value={profile.budgetMin} onChange={(event) => updateProfile('budgetMin', Number(event.target.value || 0))} type="number" className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-[#f5f5f7] outline-none transition focus:border-[#ff3b30]" />
                </label>
                <label className="space-y-2 text-sm text-[#d8d8dc]">
                  <span>Budget max</span>
                  <input value={profile.budgetMax} onChange={(event) => updateProfile('budgetMax', Number(event.target.value || 0))} type="number" className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-[#f5f5f7] outline-none transition focus:border-[#ff3b30]" />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={applyProfileBudget} className="rounded-full bg-[#ff3b30] px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]">
                  Apply budget
                </button>
                <button onClick={() => setShowOnboarding(true)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-[#f5f5f7] active:scale-[0.98]">
                  How it works
                </button>
              </div>

              <details className="mt-6 rounded-[24px] border border-white/8 bg-[#111113] p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-[#f5f5f7]">Debug</summary>
                <div className="mt-4 grid gap-3 text-sm text-[#d8d8dc] sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/5 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">AI enabled</div><div className="mt-1 font-semibold text-[#f5f5f7]">{payload.debug.aiEnabled ? 'Yes' : 'No'}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">API key present</div><div className="mt-1 font-semibold text-[#f5f5f7]">{payload.debug.apiKeyPresent ? 'Yes' : 'No'}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Version</div><div className="mt-1 font-semibold text-[#f5f5f7]">{payload.debug.appVersion}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Visible jobs</div><div className="mt-1 font-semibold text-[#f5f5f7]">{visibleProjects.length}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Stored summaries</div><div className="mt-1 font-semibold text-[#f5f5f7]">{visibleStoredCount}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Summaries needed</div><div className="mt-1 font-semibold text-[#f5f5f7]">{visibleNeedsSummaryCount}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Trade notes needed</div><div className="mt-1 font-semibold text-[#f5f5f7]">{visibleNeedsTradeNoteCount}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Refresh needed</div><div className="mt-1 font-semibold text-[#f5f5f7]">{visibleNeedsRefreshCount}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3 sm:col-span-2"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Last generate action</div><div className="mt-1 font-semibold text-[#f5f5f7]">{payload.debug.lastGenerateActionResult || 'No generate action yet'}</div></div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3 sm:col-span-2"><div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Last regenerate action</div><div className="mt-1 font-semibold text-[#f5f5f7]">{payload.debug.lastRegenerateActionResult || 'No regenerate action yet'}</div></div>
                </div>

                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[#8e8e93]">Single job tools</div>
                  <label className="mt-3 flex items-center gap-2 text-sm text-[#d8d8dc]">
                    <input type="checkbox" checked={debugBypassCache} onChange={(event) => setDebugBypassCache(event.target.checked)} className="rounded border-white/20 bg-white/5" />
                    Bypass cache on generation
                  </label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <input value={debugProjectId} onChange={(event) => setDebugProjectId(event.target.value)} type="text" placeholder="Project ID" className="min-w-[180px] flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#f5f5f7] outline-none" />
                    <button onClick={handleRegenerate} disabled={isRegenerating || !debugProjectId.trim()} className={clsx('rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]', isRegenerating || !debugProjectId.trim() ? 'bg-white/10 text-[#636366]' : 'bg-[#ff3b30] text-white')}>
                      {isRegenerating ? 'Generating…' : 'Generate summary'}
                    </button>
                    <button onClick={handleGenerateTradeNote} disabled={isGeneratingTradeNote || !debugProjectId.trim() || !profile.trade} className={clsx('rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]', isGeneratingTradeNote || !debugProjectId.trim() || !profile.trade ? 'bg-white/10 text-[#636366]' : 'border border-white/10 bg-white/5 text-[#f5f5f7]')}>
                      {isGeneratingTradeNote ? 'Generating note…' : 'Generate trade note'}
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button onClick={handleGenerateVisibleAi} disabled={isGeneratingVisibleAi || !visibleProjects.length} className={clsx('rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]', isGeneratingVisibleAi || !visibleProjects.length ? 'bg-white/10 text-[#636366]' : 'bg-white text-black')}>
                      {isGeneratingVisibleAi ? 'Generating summaries…' : 'Generate summaries for visible jobs'}
                    </button>
                    <button onClick={handleGenerateVisibleTradeNotes} disabled={isGeneratingVisibleTradeNotes || !visibleProjects.length || !profile.trade} className={clsx('rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]', isGeneratingVisibleTradeNotes || !visibleProjects.length || !profile.trade ? 'bg-white/10 text-[#636366]' : 'border border-white/10 bg-white/5 text-[#f5f5f7]')}>
                      {isGeneratingVisibleTradeNotes ? 'Generating trade notes…' : 'Generate trade notes for visible jobs'}
                    </button>
                    <button onClick={handleRegenerateVisibleAi} disabled={isRegeneratingVisibleAi || !visibleProjects.length} className={clsx('rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]', isRegeneratingVisibleAi || !visibleProjects.length ? 'bg-white/10 text-[#636366]' : 'border border-white/10 bg-white/5 text-[#f5f5f7]')}>
                      {isRegeneratingVisibleAi ? 'Regenerating content…' : 'Regenerate visible jobs'}
                    </button>
                  </div>

                  {visibleGenerationProgress ? (
                    <div className="mt-4 rounded-2xl bg-white/5 px-4 py-3 text-sm text-[#d8d8dc]">
                      <div>{visibleGenerationProgress.actionLabel}: {visibleGenerationProgress.processed} / {visibleGenerationProgress.needed} processed</div>
                      <div className="mt-1">{visibleGenerationProgress.succeeded} completed • {visibleGenerationProgress.failed} failed • batch {visibleGenerationProgress.batchIndex} / {visibleGenerationProgress.batchCount || 0}</div>
                      <div className="mt-1 text-[#8e8e93]">Status: {visibleGenerationProgress.status}</div>
                    </div>
                  ) : null}

                  {regenerateStatus ? <div className="mt-3 text-sm text-[#d8d8dc]">{regenerateStatus}</div> : null}
                </div>
              </details>
            </div>
          </section>
        ) : null}
      </main>

      <nav className="fixed inset-x-0 bottom-4 z-50 px-4">
        <div className="mx-auto flex w-full max-w-md items-center justify-between rounded-[26px] border border-white/12 bg-[rgba(17,17,19,0.52)] px-3 py-3 shadow-[0_24px_70px_rgba(0,0,0,0.58),0_0_0_1px_rgba(255,255,255,0.06)_inset,0_0_26px_rgba(255,255,255,0.03)] backdrop-blur-[24px]">
          {MOBILE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex-1 rounded-[18px] px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] transition duration-150 active:scale-[0.98]',
                activeTab === tab.key
                  ? 'bg-[#ff3b30] text-white shadow-[0_12px_24px_rgba(255,59,48,0.22)]'
                  : 'text-[#8e8e93] hover:bg-white/[0.03]'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {showOnboarding && onboardingReady ? (
        <div className="fixed inset-0 z-[60] bg-black/92 px-4 py-6">
          <div className="mx-auto flex h-full w-full max-w-md flex-col justify-end">
            <div className="rounded-[32px] border border-white/10 bg-[#111113] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8e8e93]">BidHammer</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#ff3b30]">{APP_VERSION}</div>
              <div
                ref={onboardingTrackRef}
                className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2"
                onScroll={(event) => {
                  const width = event.currentTarget.clientWidth + 16;
                  setOnboardingIndex(Math.round(event.currentTarget.scrollLeft / width));
                }}
              >
                {ONBOARDING_CARDS.map((copy) => (
                  <div key={copy} className="min-w-full snap-center rounded-[28px] border border-white/10 bg-[#1c1c1e] p-6 text-[#f5f5f7]">
                    <div className="text-3xl leading-tight">{copy}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-2">
                  {ONBOARDING_CARDS.map((_, index) => (
                    <div key={index} className={clsx('h-2 rounded-full transition-all', onboardingIndex === index ? 'w-6 bg-[#ff3b30]' : 'w-2 bg-white/20')} />
                  ))}
                </div>
                {onboardingIndex < ONBOARDING_CARDS.length - 1 ? (
                  <button onClick={advanceOnboarding} className="rounded-full bg-[#ff3b30] px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]">
                    Next
                  </button>
                ) : null}
              </div>

              <div className="mt-5 rounded-[24px] border border-white/10 bg-[#1c1c1e] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8e8e93]">Select your trade</div>
                <select value={profile.trade} onChange={(event) => updateProfile('trade', event.target.value)} className="mt-3 w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-sm text-[#f5f5f7] outline-none">
                  <option value="">Select your trade</option>
                  {TRADE_OPTIONS.map((trade) => (
                    <option key={trade} value={trade}>
                      {trade}
                    </option>
                  ))}
                </select>
                <button
                  onClick={completeOnboarding}
                  disabled={!profile.trade || onboardingIndex < ONBOARDING_CARDS.length - 1}
                  className={clsx(
                    'mt-4 w-full rounded-full px-4 py-3 text-sm font-semibold transition active:scale-[0.98]',
                    profile.trade && onboardingIndex === ONBOARDING_CARDS.length - 1 ? 'bg-[#ff3b30] text-white' : 'bg-white/10 text-[#636366]'
                  )}
                >
                  Start Using the App
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
