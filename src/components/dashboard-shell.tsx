'use client';

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNowStrict, isAfter, parseISO, subDays } from 'date-fns';
import { formatCurrency } from '@/lib/format';
import { projectMatchesTrade, projectViewForMode, TRADE_OPTIONS, type FeedMode } from '@/lib/permits/trade-utils';
import type { ActiveContact, DashboardFilters, DashboardPayload, PermitProject } from '@/lib/permits/types';
import { PermitFeedCard } from './permit-feed-card';

const ProjectMap = dynamic(() => import('./project-map').then((module) => module.ProjectMap), {
  ssr: false,
  loading: () => <div className="h-[420px] rounded-[28px] bg-stone-200/70 animate-pulse" />
});

type Props = {
  initialPayload: DashboardPayload;
  initialTab?: 'home' | 'jobs' | 'builders' | 'profile';
};

type TabKey = 'home' | 'jobs' | 'builders' | 'profile';
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

type TimeframeResolution = {
  requested: TimeframeKey;
  displayed: TimeframeKey;
  projects: PermitProject[];
  message: string | null;
};

const PROFILE_KEY = 'nbi-profile-v1';
const ONBOARDING_KEY = 'nbi-onboarding-complete-v1';

const ONBOARDING_CARDS = [
  'Nashville Build Insider scans live permit data to surface real construction opportunities.',
  'Choose your trade to see the projects most relevant to your work.',
  'View active contractors and contact them directly from the app.',
  'Track new permits across Nashville in real time.'
] as const;

const MOBILE_TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'builders', label: 'Builders' },
  { key: 'profile', label: 'Profile' }
];

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

function labelForTimeframe(timeframe: TimeframeKey): string {
  if (timeframe === 'new') return 'This Week';
  if (timeframe === 'active') return 'This Month';
  return 'Earlier';
}

function resolveTimeframeProjects(projects: PermitProject[], requested: TimeframeKey): TimeframeResolution {
  const order: TimeframeKey[] = requested === 'new' ? ['new', 'active', 'older'] : requested === 'active' ? ['active', 'older'] : ['older'];

  for (const timeframe of order) {
    const results = projectsForTimeframe(projects, timeframe);
    if (!results.length) continue;

    if (timeframe === requested) {
      return { requested, displayed: timeframe, projects: results, message: null };
    }

    if (requested === 'new' && timeframe === 'active') {
      return {
        requested,
        displayed: timeframe,
        projects: results,
        message: 'No new permits in the last 7 days. Showing recent activity.'
      };
    }

    if (requested === 'new' && timeframe === 'older') {
      return {
        requested,
        displayed: timeframe,
        projects: results,
        message: 'No new or recent permits in the last 30 days. Showing older activity.'
      };
    }

    if (requested === 'active' && timeframe === 'older') {
      return {
        requested,
        displayed: timeframe,
        projects: results,
        message: 'No permits from the past month. Showing earlier activity.'
      };
    }
  }

  return { requested, displayed: requested, projects: [], message: null };
}

function buildMarketNote(trade: string, projects: PermitProject[]): string {
  if (!trade) return 'Choose your trade and we’ll tune the brief around the permits most worth your time.';
  if (!projects.length) return `${trade} activity is quiet in the current filter set.`;

  const latestWeek = projects.filter((project) => isAfter(parseISO(project.issueDate), subDays(new Date(), 7)));
  const descriptors = latestWeek.length ? latestWeek : projects.slice(0, 10);
  const text = descriptors.map((project) => `${project.permitSubtype} ${project.readableSummary}`.toLowerCase()).join(' ');

  const phrases: string[] = [];
  phrases.push(`${trade} activity is ${latestWeek.length >= 4 ? 'busy' : latestWeek.length >= 2 ? 'steady' : 'light'} this week.`);
  if (text.includes('restaurant')) phrases.push('Restaurant work is still showing up.');
  if (text.includes('interior') || text.includes('tenant finish') || text.includes('build-out')) phrases.push('Interior build-outs are carrying a lot of the volume.');
  if (text.includes('medical')) phrases.push('A few medical jobs are mixed in.');
  phrases.push(`${Math.min(projects.length, 8)} permits look worth a call.`);

  return phrases.join(' ');
}

export function DashboardShell({ initialPayload, initialTab = 'home' }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [filters, setFilters] = useState<DashboardFilters>(initialPayload.filters);
  const [payload, setPayload] = useState<DashboardPayload>(initialPayload);
  const [isLoading, setIsLoading] = useState(false);
  const [feedMode, setFeedMode] = useState<FeedMode>('my-trade');
  const [requestedTimeframe, setRequestedTimeframe] = useState<TimeframeKey>('new');
  const [jobsView, setJobsView] = useState<'feed' | 'map'>('feed');
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => getInitialProfile(initialPayload));
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const onboardingTrackRef = useRef<HTMLDivElement | null>(null);

  const deferredNeighborhood = useDeferredValue(filters.neighborhood);
  const deferredContractor = useDeferredValue(filters.contractorQuery);

  const requestFilters = useMemo(
    () => ({
      ...filters,
      neighborhood: deferredNeighborhood,
      contractorQuery: deferredContractor
    }),
    [deferredContractor, deferredNeighborhood, filters]
  );

  const requestQuery = useMemo(() => {
    const params = new URLSearchParams(buildQuery(requestFilters));
    if (profile.trade) params.set('trade', profile.trade);
    return params.toString();
  }, [profile.trade, requestFilters]);

  const contactContextQuery = useMemo(() => {
    const params = new URLSearchParams(buildQuery(requestFilters));
    params.set('mode', feedMode);
    if (profile.trade) params.set('trade', profile.trade);
    return params.toString();
  }, [feedMode, profile.trade, requestFilters]);

  useEffect(() => {
    const storedProfile = window.localStorage.getItem(PROFILE_KEY);
    if (storedProfile) {
      const parsed = JSON.parse(storedProfile) as Partial<UserProfile>;
      const merged = { ...getInitialProfile(initialPayload), ...parsed };
      setProfile(merged);
      setFeedMode(merged.defaultFeedMode);
      setFilters((current) => ({
        ...current,
        minBudget: merged.budgetMin,
        maxBudget: merged.budgetMax
      }));
    }

    setShowOnboarding(true);
    setOnboardingReady(true);
  }, [initialPayload]);

  useEffect(() => {
    if (!onboardingReady) return;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [onboardingReady, profile]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);

      try {
        const response = await fetch(`/api/permits?${requestQuery}`, {
          signal: controller.signal,
          cache: 'no-store'
        });
        if (!response.ok) throw new Error('Failed to refresh permits');
        const nextPayload = (await response.json()) as DashboardPayload;
        startTransition(() => setPayload(nextPayload));
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.error(error);
      } finally {
        setIsLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [requestQuery]);

  const baseProjects = useMemo(() => {
    if (feedMode === 'my-trade' && profile.trade) return projectViewForMode(payload.projects, 'my-trade', profile.trade);
    if (feedMode === 'my-trade' && !profile.trade) return [];
    return payload.projects;
  }, [feedMode, payload.projects, profile.trade]);

  const timeframeState = useMemo(() => resolveTimeframeProjects(baseProjects, requestedTimeframe), [baseProjects, requestedTimeframe]);
  const visibleProjects = timeframeState.projects;
  const visibleContacts = useMemo(() => aggregateContacts(baseProjects), [baseProjects]);
  const newThisWeekCount = useMemo(
    () => baseProjects.filter((project) => isAfter(parseISO(project.issueDate), subDays(new Date(), 7))).length,
    [baseProjects]
  );
  const dashboardPreviewContacts = visibleContacts.slice(0, 3);
  const dashboardPreviewProjects = visibleProjects.slice(0, 3);
  const marketNote = buildMarketNote(profile.trade, baseProjects);
  const jobsSummary = useMemo(() => {
    if (!profile.trade) {
      return `${visibleProjects.length} permits in ${labelForTimeframe(timeframeState.displayed)}.`;
    }

    if (!visibleProjects.length) {
      return `No ${profile.trade.toLowerCase()} permits in ${labelForTimeframe(timeframeState.displayed)} right now.`;
    }

    return `${visibleProjects.length} ${profile.trade.toLowerCase()} permits in ${labelForTimeframe(timeframeState.displayed)}.`;
  }, [profile.trade, timeframeState.displayed, visibleProjects.length]);

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
    setFeedMode(profile.defaultFeedMode);
  }

  function advanceOnboarding() {
    const nextIndex = Math.min(onboardingIndex + 1, ONBOARDING_CARDS.length - 1);
    setOnboardingIndex(nextIndex);
    onboardingTrackRef.current?.children[nextIndex]?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
  }

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-28 pt-5 sm:px-6">
        <header className="rounded-[28px] border border-white/10 bg-[rgba(12,13,16,0.78)] px-4 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-400">Nashville Build Insider</p>
              <h1 className="mt-2 font-display text-3xl leading-none text-white">Live local permit intelligence for Nashville subcontractors.</h1>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right text-xs text-stone-400">
              <div>Updated from live permits</div>
              <div className="mt-1 font-medium text-stone-100">{formatDistanceToNowStrict(new Date(payload.asOf), { addSuffix: true })}</div>
            </div>
          </div>
        </header>

        <div key={activeTab} className="mt-5 animate-[fade_up_220ms_ease]">
          {activeTab === 'home' ? (
            <section className="space-y-4">
              <div className="rounded-[28px] border border-white/10 bg-[rgba(15,16,18,0.8)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">{profile.trade ? `${profile.trade} briefing` : 'Market briefing'}</div>
                <h2 className="mt-2 font-display text-3xl leading-tight text-white">
                  {profile.trade ? `Here’s how ${profile.trade.toLowerCase()} work looks right now.` : 'Choose a trade to personalize the brief.'}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">{marketNote}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[24px] bg-stone-950 px-4 py-4 text-white shadow-[0_16px_40px_rgba(28,25,23,0.16)]">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-stone-300">Trade matches</div>
                  <div className="mt-2 text-3xl font-semibold">{baseProjects.length}</div>
                </div>
                <div className="rounded-[24px] bg-amber-100 px-4 py-4 text-stone-950 shadow-[0_16px_40px_rgba(180,83,9,0.12)]">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-amber-900/70">New this week</div>
                  <div className="mt-2 text-3xl font-semibold">{newThisWeekCount}</div>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[rgba(15,16,18,0.8)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display text-2xl text-white">Worth a quick look</h3>
                    <p className="mt-1 text-sm text-stone-400">A few permits and builders to check first.</p>
                  </div>
                  <button onClick={() => setActiveTab('jobs')} className="rounded-full border border-white/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-100 active:scale-[0.98]">
                    Open Jobs
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  {dashboardPreviewProjects.map((project) => (
                    <a key={project.id} href={`/projects/${project.id}${profile.trade ? `?trade=${encodeURIComponent(profile.trade)}` : ''}`} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 transition hover:border-amber-300 active:scale-[0.99]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{project.address || 'Address pending'}</div>
                          <div className="mt-1 text-sm text-stone-300">{project.readableSummary}</div>
                        </div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">{project.issueDateLabel}</div>
                      </div>
                    </a>
                  ))}
                </div>

                <div className="mt-5 border-t border-stone-100 pt-5">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-400">Top builders</h4>
                  <div className="mt-3 grid gap-3">
                    {dashboardPreviewContacts.map((contact) => (
                      <a key={contact.name} href={`/contacts?name=${encodeURIComponent(contact.name)}&${contactContextQuery}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:border-amber-300 active:scale-[0.99]">
                        <div>
                          <div className="text-sm font-semibold text-white">{contact.name}</div>
                          <div className="mt-1 text-sm text-stone-300">
                            {contact.projectCount} projects • {formatCurrency(contact.totalValuation)}
                          </div>
                        </div>
                        <div className="text-xs uppercase tracking-[0.16em] text-stone-400">Open</div>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === 'jobs' ? (
            <section className="space-y-4">
              <div className="rounded-[28px] border border-white/10 bg-[rgba(15,16,18,0.8)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-3xl text-white">Jobs</h2>
                    <p className="mt-1 text-sm text-stone-300">{jobsSummary}</p>
                  </div>
                  <div className="text-xs uppercase tracking-[0.16em] text-stone-400">{isLoading ? 'Refreshing' : `${labelForTimeframe(timeframeState.displayed)}`}</div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <div className="inline-flex rounded-full border border-stone-200 bg-stone-100 p-1 text-sm font-semibold">
                    <button onClick={() => setFeedMode('my-trade')} className={clsx('rounded-full px-4 py-2 transition active:scale-[0.98]', feedMode === 'my-trade' ? 'bg-stone-950 text-white' : 'text-stone-700')}>
                      My Trade
                    </button>
                    <button onClick={() => setFeedMode('all-jobs')} className={clsx('rounded-full px-4 py-2 transition active:scale-[0.98]', feedMode === 'all-jobs' ? 'bg-stone-950 text-white' : 'text-stone-700')}>
                      All Jobs
                    </button>
                  </div>

                  <div className="inline-flex rounded-full border border-stone-200 bg-stone-100 p-1 text-sm font-semibold">
                    <button onClick={() => setJobsView('feed')} className={clsx('rounded-full px-4 py-2 transition active:scale-[0.98]', jobsView === 'feed' ? 'bg-stone-950 text-white shadow-[0_10px_24px_rgba(28,25,23,0.16)]' : 'text-stone-700')}>
                      Feed
                    </button>
                    <button onClick={() => setJobsView('map')} className={clsx('rounded-full px-4 py-2 transition active:scale-[0.98]', jobsView === 'map' ? 'bg-stone-950 text-white shadow-[0_10px_24px_rgba(28,25,23,0.16)]' : 'text-stone-700')}>
                      Map
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {(['new', 'active', 'older'] as TimeframeKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        setRequestedTimeframe(key);
                        setExpandedJobId(null);
                      }}
                      className={clsx(
                        'rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]',
                        timeframeState.displayed === key ? 'bg-stone-950 text-white' : 'border border-stone-300 bg-white text-stone-700'
                      )}
                    >
                      {key === 'new' ? 'This Week' : key === 'active' ? 'This Month' : 'Earlier'}
                    </button>
                  ))}
                </div>

                {timeframeState.message ? <div className="mt-4 rounded-2xl bg-amber-400/10 px-4 py-3 text-sm text-amber-100 ring-1 ring-amber-300/20">{timeframeState.message}</div> : null}
              </div>

              <details className="group rounded-[24px] border border-white/10 bg-[rgba(15,16,18,0.72)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-stone-100">
                  <span>Refine</span>
                  <span className="text-xs uppercase tracking-[0.16em] text-stone-400 group-open:hidden">Open</span>
                  <span className="hidden text-xs uppercase tracking-[0.16em] text-stone-400 group-open:inline">Close</span>
                </summary>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Sort</span>
                    <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as DashboardFilters['sort'] }))} className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400">
                      <option value="newest">Newest</option>
                      <option value="highest">Highest Value</option>
                      <option value="lowest">Lowest Value</option>
                    </select>
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Budget min</span>
                    <input value={filters.minBudget} onChange={(event) => setFilters((current) => ({ ...current, minBudget: Number(event.target.value || 0) }))} type="number" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Budget max</span>
                    <input value={filters.maxBudget} onChange={(event) => setFilters((current) => ({ ...current, maxBudget: Number(event.target.value || 0) }))} type="number" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Neighborhood or ZIP</span>
                    <input value={filters.neighborhood} onChange={(event) => setFilters((current) => ({ ...current, neighborhood: event.target.value }))} type="text" placeholder="East Nashville or 37206" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                </div>
                <div className="mt-4">
                  <button onClick={applyProfileBudget} className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 active:scale-[0.98]">
                    Use Profile Budget
                  </button>
                </div>
              </details>

              <div className="relative">
                <div className={clsx('transition duration-200', jobsView === 'map' ? 'pointer-events-none absolute inset-0 translate-y-2 opacity-0' : 'opacity-100')}>
                  <div className="space-y-4">
                    {visibleProjects.map((project) => (
                      <PermitFeedCard
                        key={project.id}
                        project={project}
                        trade={profile.trade}
                        contactHref={`/contacts?name=${encodeURIComponent(project.contactName)}&${contactContextQuery}`}
                        expanded={expandedJobId === project.id}
                        onToggle={() => setExpandedJobId((current) => (current === project.id ? null : project.id))}
                      />
                    ))}
                    {!visibleProjects.length ? <div className="rounded-[24px] border border-dashed border-stone-300 bg-white/70 px-5 py-12 text-center text-sm text-stone-500">No permits match the current view.</div> : null}
                  </div>
                </div>

                <div className={clsx('transition duration-200', jobsView === 'map' ? 'opacity-100' : 'pointer-events-none absolute inset-0 -translate-y-2 opacity-0')}>
                  <ProjectMap projects={visibleProjects} trade={profile.trade} />
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === 'builders' ? (
            <section className="space-y-4">
              <div className="rounded-[28px] border border-white/10 bg-[rgba(15,16,18,0.8)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <h2 className="font-display text-3xl text-white">Builders</h2>
                <p className="mt-1 text-sm text-stone-300">Call and email actions first, with project count and valuation for context.</p>
              </div>

              <div className="space-y-4">
                {visibleContacts.map((contact) => (
                  <article key={contact.name} className="rounded-[24px] border border-white/10 bg-[rgba(15,16,18,0.8)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-semibold text-white">{contact.name}</h3>
                        <p className="mt-2 text-sm text-stone-300">
                          {contact.projectCount} projects • {formatCurrency(contact.totalValuation)}
                        </p>
                        {contact.phone ? <p className="mt-2 text-sm text-stone-200">{contact.phone}</p> : null}
                        {contact.email ? <p className="mt-1 text-sm text-stone-200">{contact.email}</p> : null}
                        {!contact.phone && !contact.email ? <p className="mt-2 text-sm text-stone-400">Contact info unavailable</p> : null}
                      </div>
                      <a href={`/contacts?name=${encodeURIComponent(contact.name)}&${contactContextQuery}`} className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-stone-100 active:scale-[0.98]">
                        Open
                      </a>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                      {contact.phone ? <a href={formatPhoneHref(contact.phone)} className="rounded-full bg-amber-400 px-4 py-2 text-stone-950 active:scale-[0.98]">Call</a> : null}
                      {contact.email ? <a href={`mailto:${contact.email}`} className="rounded-full border border-white/20 px-4 py-2 text-stone-100 active:scale-[0.98]">Email</a> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === 'profile' ? (
            <section className="space-y-4">
              <div className="rounded-[28px] border border-white/10 bg-[rgba(15,16,18,0.8)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <h2 className="font-display text-3xl text-white">Profile</h2>
                <p className="mt-1 text-sm text-stone-300">Local-only profile fields for shaping the app while auth is still out of scope.</p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Email</span>
                    <input value={profile.email} onChange={(event) => updateProfile('email', event.target.value)} type="email" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Username</span>
                    <input value={profile.username} onChange={(event) => updateProfile('username', event.target.value)} type="text" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Business name</span>
                    <input value={profile.businessName} onChange={(event) => updateProfile('businessName', event.target.value)} type="text" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Phone</span>
                    <input value={profile.phone} onChange={(event) => updateProfile('phone', event.target.value)} type="tel" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Selected trade</span>
                    <select value={profile.trade} onChange={(event) => updateProfile('trade', event.target.value)} className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400">
                      <option value="">Select your trade</option>
                      {TRADE_OPTIONS.map((trade) => (
                        <option key={trade} value={trade}>
                          {trade}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Default view</span>
                    <select value={profile.defaultFeedMode} onChange={(event) => updateProfile('defaultFeedMode', event.target.value as FeedMode)} className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400">
                      <option value="my-trade">My Trade</option>
                      <option value="all-jobs">All Jobs</option>
                    </select>
                  </label>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Budget preference min</span>
                    <input value={profile.budgetMin} onChange={(event) => updateProfile('budgetMin', Number(event.target.value || 0))} type="number" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                  <label className="space-y-2 text-sm text-stone-700">
                    <span>Budget preference max</span>
                    <input value={profile.budgetMax} onChange={(event) => updateProfile('budgetMax', Number(event.target.value || 0))} type="number" className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none transition focus:border-amber-400" />
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      setFeedMode(profile.defaultFeedMode);
                      applyProfileBudget();
                    }}
                    className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
                  >
                    Apply to app
                  </button>
                  <button onClick={() => setShowOnboarding(true)} className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-stone-100 active:scale-[0.98]">
                    How it works
                  </button>
                  <div className="rounded-full bg-white/10 px-4 py-2 text-sm text-stone-300">This Week = last 7 days • This Month = 8 to 30 days • Earlier = 30+ days</div>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200/80 bg-white/92 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 shadow-[0_-18px_40px_rgba(43,37,20,0.1)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-3">
          {MOBILE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'rounded-2xl px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.16em] transition active:scale-[0.98]',
                activeTab === tab.key ? 'bg-stone-950 text-white shadow-[0_10px_30px_rgba(28,25,23,0.18)]' : 'text-stone-500'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {showOnboarding && onboardingReady ? (
        <div className="fixed inset-0 z-50 bg-[rgba(28,25,23,0.46)] px-4 py-6 backdrop-blur-xl">
          <div className="mx-auto flex h-full w-full max-w-md flex-col justify-end">
            <div className="rounded-[32px] border border-white/20 bg-[linear-gradient(180deg,rgba(28,25,23,0.96),rgba(59,48,37,0.96))] p-5 shadow-[0_30px_90px_rgba(18,14,10,0.42)]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">Welcome</div>
              <div
                ref={onboardingTrackRef}
                className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2"
                onScroll={(event) => {
                  const width = event.currentTarget.clientWidth + 16;
                  setOnboardingIndex(Math.round(event.currentTarget.scrollLeft / width));
                }}
              >
                {ONBOARDING_CARDS.map((copy) => (
                  <div key={copy} className="min-w-full snap-center rounded-[28px] border border-white/12 bg-white/10 p-6 text-white/92 backdrop-blur">
                    <div className="font-display text-3xl leading-tight">{copy}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-2">
                  {ONBOARDING_CARDS.map((_, index) => (
                    <div key={index} className={clsx('h-2 rounded-full transition-all', onboardingIndex === index ? 'w-6 bg-amber-300' : 'w-2 bg-white/25')} />
                  ))}
                </div>
                {onboardingIndex < ONBOARDING_CARDS.length - 1 ? (
                  <button onClick={advanceOnboarding} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-stone-900 active:scale-[0.98]">
                    Next
                  </button>
                ) : null}
              </div>

              <div className="mt-5 rounded-[24px] border border-white/12 bg-white/8 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">Select your trade</div>
                <select value={profile.trade} onChange={(event) => updateProfile('trade', event.target.value)} className="mt-3 w-full rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-sm text-white outline-none">
                  <option value="" className="text-stone-900">
                    Select your trade
                  </option>
                  {TRADE_OPTIONS.map((trade) => (
                    <option key={trade} value={trade} className="text-stone-900">
                      {trade}
                    </option>
                  ))}
                </select>
                <button
                  onClick={completeOnboarding}
                  disabled={!profile.trade || onboardingIndex < ONBOARDING_CARDS.length - 1}
                  className={clsx(
                    'mt-4 w-full rounded-full px-4 py-3 text-sm font-semibold transition active:scale-[0.98]',
                    profile.trade && onboardingIndex === ONBOARDING_CARDS.length - 1 ? 'bg-amber-300 text-stone-900' : 'bg-white/15 text-white/45'
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
