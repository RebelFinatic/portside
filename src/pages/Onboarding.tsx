import { useContext, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Code2, FolderOpen, Link2, Loader2, PackageOpen, ServerCog } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import { OnboardingStatusContext } from '../context/OnboardingStatusContext';

type Milestone =
  | 'account_created'
  | 'environment_checked'
  | 'recipe_selected'
  | 'variables_completed'
  | 'deployment_planned'
  | 'deployment_applied'
  | 'go_live_ready';

type DeploymentSource = 'catalog' | 'existing-data' | 'remote-url' | 'custom-yaml';

interface OnboardingState {
  adminId: string;
  completed: boolean;
  skipped: boolean;
  milestone: Milestone;
  deploymentSource: DeploymentSource | null;
  attachedTargetPath: string | null;
  defaultTargetPath: string | null;
  milestones: Record<Milestone, string | null>;
}

interface WizardStatus {
  setupRequired: boolean;
  hasOwner: boolean;
  defaultTargetPath: string | null;
}

interface CatalogEntry {
  id: string;
  name: string;
  source: string;
  description: string | null;
}

interface RecipeInspection {
  variables: string[];
  warnings: string[];
}

interface DeployerPlan {
  id: string;
  impactSummary: Record<string, number>;
  warnings: string[];
  steps: Array<{ id: string; stepIndex: number; action: string; label: string }>;
}

interface ExistingValidation {
  ok?: boolean;
  targetPath?: string;
  checks?: Record<string, boolean>;
  warnings?: string[];
  error?: string;
  defaultTargetPath?: string | null;
}

const defaultVariables: Record<string, string> = {
  serverName: 'Portside Server',
  maxClients: '48',
  serverEndpoints: '0.0.0.0:30120',
  svLicense: '',
  dbHost: 'localhost',
  dbPort: '3306',
  dbUsername: 'root',
  dbPassword: '',
  dbName: 'fivem',
};

const sensitivePattern = /(password|secret|token|license|connection|string|key)/i;

const wizardSteps = [
  { title: 'Owner Account', description: 'Create the first administrator.' },
  { title: 'Environment', description: 'Check paths, monitor, and server mode.' },
  { title: 'Deployment Source', description: 'Choose a recipe or attach existing data.' },
  { title: 'Variables', description: 'Fill in server and framework settings.' },
  { title: 'Plan + Apply', description: 'Review file impact before writing.' },
  { title: 'Go Live', description: 'Finish setup and enter Portside.' },
];

const sourceOptions: Array<{
  id: DeploymentSource;
  title: string;
  description: string;
  badge?: string;
  icon: typeof PackageOpen;
}> = [
  {
    id: 'catalog',
    title: 'Popular Recipes',
    description: 'Start from curated txAdmin-compatible recipes. Best for new servers.',
    badge: 'Recommended',
    icon: PackageOpen,
  },
  {
    id: 'existing-data',
    title: 'Existing Server Data',
    description: 'Attach a server-data folder without modifying files.',
    icon: FolderOpen,
  },
  {
    id: 'remote-url',
    title: 'Remote URL',
    description: 'Inspect and deploy a recipe from a raw YAML URL.',
    icon: Link2,
  },
  {
    id: 'custom-yaml',
    title: 'Custom YAML',
    description: 'Paste a recipe directly for advanced setup work.',
    icon: Code2,
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { isAuthenticated, user, login } = useAuthStore();
  const { refreshOnboardingStatus } = useContext(OnboardingStatusContext);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [wizardStatus, setWizardStatus] = useState<WizardStatus | null>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [source, setSource] = useState<DeploymentSource>('catalog');
  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customYaml, setCustomYaml] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [inspection, setInspection] = useState<RecipeInspection | null>(null);
  const [plan, setPlan] = useState<DeployerPlan | null>(null);
  const [confirmationToken, setConfirmationToken] = useState('');
  const [goLiveChecks, setGoLiveChecks] = useState<Record<string, unknown> | null>(null);
  const [existingValidation, setExistingValidation] = useState<ExistingValidation | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>(defaultVariables);
  const [ownerUsername, setOwnerUsername] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerPasswordConfirm, setOwnerPasswordConfirm] = useState('');
  const isMountedRef = useRef(true);
  const suppressToastsRef = useRef(false);

  const ownerStepRequired = !wizardStatus?.hasOwner;

  const load = async () => {
    setLoading(true);
    try {
      const status = await apiFetch('/setup/wizard/state');
      setWizardStatus(status);
      setTargetPath(status.defaultTargetPath || '');

      if (!status.setupRequired && isAuthenticated && user) {
        const [onboardingState, catalogResponse] = await Promise.all([
          apiFetch('/onboarding/state'),
          apiFetch('/deployer/catalog'),
        ]);
        if (onboardingState.completed || onboardingState.skipped) {
          navigate('/', { replace: true });
          return;
        }
        setState(onboardingState);
        const recipes = Array.isArray(catalogResponse.recipes) ? catalogResponse.recipes : [];
        setCatalog(recipes);
        if (recipes.length > 0 && !selectedRecipeId) setSelectedRecipeId(recipes[0].id);
        if (catalogResponse.defaultTargetPath && !targetPath) setTargetPath(catalogResponse.defaultTargetPath);
        setSource(onboardingState.deploymentSource || 'catalog');
        setStep(syncStepFromState(onboardingState));
      } else {
        setStep(0);
      }
    } catch (error: any) {
      if (suppressToastsRef.current || !isMountedRef.current) return;
      toast.error('Failed to load onboarding', { description: error.message });
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    load();
    return () => {
      isMountedRef.current = false;
    };
  }, [isAuthenticated]);

  const syncStepFromState = (nextState: OnboardingState) => {
    if (nextState.completed) return 5;
    const order: Milestone[] = ['environment_checked', 'recipe_selected', 'variables_completed', 'deployment_planned', 'deployment_applied', 'go_live_ready'];
    const index = order.findIndex(item => item === nextState.milestone);
    return Math.max(1, index + 1);
  };

  const updateOnboarding = async (payload: {
    milestone?: Milestone;
    deploymentSource?: DeploymentSource;
    attachedTargetPath?: string | null;
    completed?: boolean;
    skipped?: boolean;
  }) => {
    const next = await apiFetch('/onboarding/state', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!isMountedRef.current) return next as OnboardingState;
    setState(next);
    setStep(syncStepFromState(next));
    return next as OnboardingState;
  };

  const ensureAuthenticatedForWizard = () => {
    if (!isAuthenticated) throw new Error('Create the owner account first.');
  };

  const handleOwnerCreate = async () => {
    if (ownerPassword !== ownerPasswordConfirm) {
      toast.error('Passwords do not match');
      return;
    }
    setWorking(true);
    try {
      const response = await apiFetch('/setup/wizard/owner', {
        method: 'POST',
        body: JSON.stringify({ username: ownerUsername, password: ownerPassword }),
      });
      login(response.token, response.user);
      setWizardStatus({ setupRequired: false, hasOwner: true, defaultTargetPath: null });
      setState(response.onboarding);
      toast.success('Owner account created');
      const catalogResponse = await apiFetch('/deployer/catalog');
      const recipes = Array.isArray(catalogResponse.recipes) ? catalogResponse.recipes : [];
      setCatalog(recipes);
      if (recipes.length > 0 && !selectedRecipeId) setSelectedRecipeId(recipes[0].id);
      setStep(1);
    } catch (error: any) {
      if (suppressToastsRef.current || !isMountedRef.current) return;
      toast.error('Failed to create owner', { description: error.message });
    } finally {
      if (isMountedRef.current) setWorking(false);
    }
  };

  const runEnvironmentCheck = async () => {
    ensureAuthenticatedForWizard();
    setWorking(true);
    try {
      const checks = await apiFetch('/deployer/go-live-checks');
      setGoLiveChecks(checks);
      await updateOnboarding({ milestone: 'environment_checked' });
      setStep(2);
      toast.success('Environment check captured');
    } catch (error: any) {
      if (suppressToastsRef.current || !isMountedRef.current) return;
      toast.error('Environment check failed', { description: error.message });
    } finally {
      if (isMountedRef.current) setWorking(false);
    }
  };

  const persistSource = async (nextSource: DeploymentSource) => {
    setSource(nextSource);
    await updateOnboarding({ deploymentSource: nextSource, milestone: 'recipe_selected' });
  };

  const recipeBody = () => {
    if (source === 'catalog') return { catalogId: selectedRecipeId };
    if (source === 'remote-url') return { url: customUrl.trim() };
    if (source === 'custom-yaml') return { text: customYaml };
    return {};
  };

  const inspectRecipe = async () => {
    ensureAuthenticatedForWizard();
    setWorking(true);
    try {
      if (source === 'existing-data') {
        const validation = await apiFetch('/setup/wizard/existing-data/validate', {
          method: 'POST',
          body: JSON.stringify({ targetPath }),
        });
        setExistingValidation(validation);
        if (!validation.ok) {
          toast.error('Existing server data validation failed');
          return;
        }
        await updateOnboarding({
          deploymentSource: 'existing-data',
          milestone: 'deployment_applied',
          attachedTargetPath: validation.targetPath,
        });
        setStep(5);
        toast.success('Existing server data attached');
        return;
      }

      const response = await apiFetch('/deployer/recipes/inspect', {
        method: 'POST',
        body: JSON.stringify(recipeBody()),
      });
      setInspection(response);
      const nextVars = { ...defaultVariables, ...variables };
      for (const name of response.variables || []) {
        if (nextVars[name] === undefined) nextVars[name] = '';
      }
      setVariables(nextVars);
      await updateOnboarding({ milestone: 'recipe_selected', deploymentSource: source });
      setStep(3);
      toast.success('Recipe inspected');
    } catch (error: any) {
      if (suppressToastsRef.current || !isMountedRef.current) return;
      toast.error('Recipe step failed', { description: error.message });
    } finally {
      if (isMountedRef.current) setWorking(false);
    }
  };

  const createPlan = async () => {
    ensureAuthenticatedForWizard();
    if (!targetPath.trim()) {
      toast.error('Target path is required');
      return;
    }
    setWorking(true);
    try {
      await updateOnboarding({ milestone: 'variables_completed' });
      const response = await apiFetch('/deployer/plans', {
        method: 'POST',
        body: JSON.stringify({
          ...recipeBody(),
          targetPath,
          variables,
        }),
      });
      setPlan(response.plan);
      setConfirmationToken(response.confirmationToken);
      await updateOnboarding({ milestone: 'deployment_planned' });
      setStep(4);
      toast.success('Deployment plan created');
    } catch (error: any) {
      if (suppressToastsRef.current || !isMountedRef.current) return;
      toast.error('Plan creation failed', { description: error.message });
    } finally {
      if (isMountedRef.current) setWorking(false);
    }
  };

  const applyPlan = async () => {
    ensureAuthenticatedForWizard();
    if (!plan) return;
    setWorking(true);
    try {
      const response = await apiFetch(`/deployer/plans/${plan.id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ confirmationToken }),
      });
      if (response.job?.status !== 'success') throw new Error(response.job?.error || 'Deployment failed');
      await updateOnboarding({ milestone: 'deployment_applied' });
      setStep(5);
      toast.success('Deployment applied');
    } catch (error: any) {
      if (suppressToastsRef.current || !isMountedRef.current) return;
      toast.error('Failed to apply plan', { description: error.message });
    } finally {
      if (isMountedRef.current) setWorking(false);
    }
  };

  const completeWizard = async () => {
    ensureAuthenticatedForWizard();
    setWorking(true);
    try {
      await apiFetch('/setup/wizard/complete', {
        method: 'POST',
        body: JSON.stringify({ targetPath }),
      });
      await refreshOnboardingStatus();
      suppressToastsRef.current = true;
      toast.success('Onboarding completed');
      navigate('/');
    } catch (error: any) {
      if (suppressToastsRef.current || !isMountedRef.current) return;
      toast.error('Failed to complete onboarding', { description: error.message });
    } finally {
      if (isMountedRef.current) setWorking(false);
    }
  };

  const skipWizard = async () => {
    ensureAuthenticatedForWizard();
    setWorking(true);
    try {
      await updateOnboarding({ skipped: true });
      await refreshOnboardingStatus();
      suppressToastsRef.current = true;
      navigate('/deployer');
    } catch (error: any) {
      if (suppressToastsRef.current || !isMountedRef.current) return;
      toast.error('Unable to skip wizard', { description: error.message });
    } finally {
      if (isMountedRef.current) setWorking(false);
    }
  };

  const goToAdvancedMode = async () => {
    await skipWizard();
  };

  const groupedVariables = useMemo(() => {
    if (!inspection) return { server: [] as string[], database: [] as string[], framework: [] as string[] };
    const groups = { server: [] as string[], database: [] as string[], framework: [] as string[] };
    for (const key of inspection.variables || []) {
      if (/(db|mysql|sql|connection)/i.test(key)) groups.database.push(key);
      else if (/(server|sv_|endpoint|max|onesync|license)/i.test(key)) groups.server.push(key);
      else groups.framework.push(key);
    }
    return groups;
  }, [inspection]);

  const activeStepIndex = ownerStepRequired ? 0 : Math.min(Math.max(step, 1), wizardSteps.length - 1);
  const selectedSourceOption = sourceOptions.find(option => option.id === source) || sourceOptions[0];
  const selectedRecipe = catalog.find(recipe => recipe.id === selectedRecipeId) || null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-7xl flex-col">
        <div className="mb-5 flex flex-col gap-4 border-b border-zinc-800/50 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-orange-400">First-run setup</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Set up Portside</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">Create the owner account, connect server data, and finish with a ready-to-operate panel.</p>
          </div>
          {isAuthenticated && !ownerStepRequired && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={goToAdvancedMode} disabled={working} className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-60">
                Advanced Mode
              </button>
              <button type="button" onClick={skipWizard} disabled={working} className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-60">
                Skip Wizard
              </button>
            </div>
          )}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
          <aside className="rounded-lg border border-zinc-800 bg-[#101010] p-4 lg:sticky lg:top-6 lg:self-start">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-orange-500/30 bg-orange-500/10">
                <ServerCog className="h-4 w-4 text-orange-300" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Setup Progress</div>
                <div className="text-xs text-zinc-500">One step at a time</div>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
              {wizardSteps.map((item, index) => (
                <StepperItem key={item.title} index={index} active={index === activeStepIndex} complete={index < activeStepIndex} title={item.title} description={item.description} />
              ))}
            </div>
          </aside>

          <main className="rounded-lg border border-zinc-800 bg-[#111]">
            <div className="border-b border-zinc-800 px-5 py-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">Step {activeStepIndex + 1} of {wizardSteps.length}</div>
              <h2 className="mt-1 text-xl font-semibold text-white">{wizardSteps[activeStepIndex].title}</h2>
              <p className="mt-1 text-sm text-zinc-500">{wizardSteps[activeStepIndex].description}</p>
            </div>

            <div className="min-h-[430px] p-5">
              {ownerStepRequired && (
                <div className="max-w-2xl">
                  <p className="text-sm leading-6 text-zinc-400">This account owns the Portside instance and can create roles, manage deployment, and configure server control. Use a strong password; you can add other admins later.</p>
                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label="Owner username" value={ownerUsername} onChange={setOwnerUsername} placeholder="rebel" />
                    <Field label="Password" type="password" value={ownerPassword} onChange={setOwnerPassword} placeholder="Minimum 10 characters" />
                    <Field label="Confirm password" type="password" value={ownerPasswordConfirm} onChange={setOwnerPasswordConfirm} placeholder="Repeat password" />
                  </div>
                </div>
              )}

              {!ownerStepRequired && !isAuthenticated && (
                <div className="max-w-xl">
                  <p className="text-sm text-zinc-500">An owner account already exists. Sign in to continue setup or manage deployment.</p>
                  <button type="button" onClick={() => navigate('/login')} className="mt-5 rounded bg-orange-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-orange-500">
                    Go To Login
                  </button>
                </div>
              )}

              {!ownerStepRequired && isAuthenticated && step <= 1 && (
                <div className="max-w-2xl">
                  <p className="text-sm leading-6 text-zinc-400">Portside will check the current server mode, monitor status, and go-live hints before touching deployment data.</p>
                  {goLiveChecks ? <StatusList data={goLiveChecks} /> : (
                    <div className="mt-5 rounded border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                      Run the check to capture the current environment. This is read-only.
                    </div>
                  )}
                </div>
              )}

              {!ownerStepRequired && isAuthenticated && step === 2 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {sourceOptions.map(option => (
                      <SourceCard key={option.id} option={option} active={source === option.id} onClick={() => persistSource(option.id)} />
                    ))}
                  </div>

                  {source === 'catalog' && (
                    <div>
                      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Choose a recipe</div>
                      <div className="grid max-h-72 grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                        {catalog.map(recipe => (
                          <button key={recipe.id} type="button" onClick={() => setSelectedRecipeId(recipe.id)} className={`rounded-lg border p-3 text-left transition-colors ${selectedRecipeId === recipe.id ? 'border-orange-500/40 bg-orange-500/10' : 'border-zinc-800 bg-black/20 hover:border-zinc-700'}`}>
                            <div className="text-sm font-semibold text-white">{recipe.name}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">{recipe.source}</div>
                            <div className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{recipe.description || 'No description provided.'}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {source === 'remote-url' && (
                    <Field label="Recipe URL" value={customUrl} onChange={setCustomUrl} placeholder="https://raw.githubusercontent.com/.../recipe.yaml" />
                  )}

                  {source === 'custom-yaml' && (
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
                      Recipe YAML
                      <textarea value={customYaml} onChange={event => setCustomYaml(event.target.value)} rows={10} placeholder="Paste recipe YAML..." className="mt-2 w-full rounded border border-zinc-800 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-zinc-600 focus:border-orange-500" />
                    </label>
                  )}

                  <Field label={source === 'existing-data' ? 'Existing server-data folder' : 'Target folder'} value={targetPath} onChange={setTargetPath} placeholder="C:/FXServer/server-data" />
                  {existingValidation && <ValidationCard validation={existingValidation} />}
                </div>
              )}

              {step === 3 && source !== 'existing-data' && inspection && (
                <div>
                  {inspection.warnings?.length ? <WarningList warnings={inspection.warnings} /> : null}
                  <VariableGroup title="Server" names={groupedVariables.server} values={variables} onChange={setVariables} />
                  <VariableGroup title="Database" names={groupedVariables.database} values={variables} onChange={setVariables} />
                  <VariableGroup title="Framework" names={groupedVariables.framework} values={variables} onChange={setVariables} />
                </div>
              )}

              {step === 4 && source !== 'existing-data' && plan && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {Object.entries(plan.impactSummary || {}).map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-zinc-800 bg-black/20 p-3">
                        <div className="text-lg font-semibold text-white">{String(value)}</div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-600">{key}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded border border-zinc-800 bg-black/30 p-3 text-xs text-zinc-400">
                    Confirmation token: <span className="font-mono text-zinc-200">{confirmationToken}</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded border border-zinc-800 bg-black/20">
                    {plan.steps.map(item => (
                      <div key={item.id} className="border-b border-zinc-900 p-3 text-xs text-zinc-400">
                        #{item.stepIndex + 1} {item.action} - {item.label}
                      </div>
                    ))}
                  </div>
                  {plan.warnings?.length ? <WarningList warnings={plan.warnings} /> : null}
                </div>
              )}

              {step >= 5 && (
                <div className="max-w-2xl">
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                      <CheckCircle2 className="h-4 w-4" />
                      Setup is ready to finish
                    </div>
                    <p className="mt-2 text-sm leading-6 text-emerald-100/70">Portside will leave first-run mode and take you to the main dashboard. You can continue deployment work from Recipe Deployer later.</p>
                  </div>
                  {state?.attachedTargetPath && (
                    <div className="mt-3 rounded border border-zinc-800 bg-black/20 p-3 text-xs text-zinc-400">
                      Attached target: <span className="font-mono text-zinc-200">{state.attachedTargetPath}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-4">
              <div>
                {activeStepIndex > 1 && !ownerStepRequired ? (
                  <button type="button" onClick={() => setStep(source === 'existing-data' && activeStepIndex >= 5 ? 2 : activeStepIndex - 1)} disabled={working} className="rounded border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs font-bold uppercase text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40">
                    Back
                  </button>
                ) : null}
              </div>
              {ownerStepRequired ? (
                <PrimaryButton onClick={handleOwnerCreate} disabled={working}>{working ? 'Creating...' : 'Create Owner And Continue'}</PrimaryButton>
              ) : !isAuthenticated ? (
                <PrimaryButton onClick={() => navigate('/login')}>Go To Login</PrimaryButton>
              ) : step <= 1 ? (
                <PrimaryButton onClick={runEnvironmentCheck} disabled={working}>{working ? 'Checking...' : 'Run Environment Check'}</PrimaryButton>
              ) : step === 2 ? (
                <PrimaryButton onClick={inspectRecipe} disabled={working || !targetPath.trim() || (source === 'catalog' && !selectedRecipeId) || (source === 'remote-url' && !customUrl.trim()) || (source === 'custom-yaml' && !customYaml.trim())}>
                  {working ? 'Working...' : (source === 'existing-data' ? 'Validate And Attach' : 'Inspect Recipe')}
                </PrimaryButton>
              ) : step === 3 && source !== 'existing-data' ? (
                <PrimaryButton onClick={createPlan} disabled={working}>{working ? 'Planning...' : 'Create Plan'}</PrimaryButton>
              ) : step === 4 && source !== 'existing-data' ? (
                <PrimaryButton tone="success" onClick={applyPlan} disabled={working}>{working ? 'Applying...' : 'Apply Deployment'}</PrimaryButton>
              ) : (
                <PrimaryButton tone="success" onClick={completeWizard} disabled={working}>{working ? 'Saving...' : 'Complete Setup'}</PrimaryButton>
              )}
            </div>
          </main>

          <aside className="rounded-lg border border-zinc-800 bg-[#101010] p-4 lg:sticky lg:top-6 lg:self-start">
            <div className="text-sm font-semibold text-white">Setup Summary</div>
            <div className="mt-4 space-y-3">
              <SummaryRow label="Owner" value={ownerStepRequired ? 'Not created yet' : (user?.username || 'Signed in')} />
              <SummaryRow label="Source" value={ownerStepRequired ? 'Choose after account' : selectedSourceOption.title} />
              <SummaryRow label="Recipe" value={selectedRecipe?.name || (source === 'catalog' ? 'No recipe selected' : 'Custom source')} />
              <SummaryRow label="Target" value={targetPath || 'Not selected'} mono={Boolean(targetPath)} />
            </div>
            <div className="mt-5 rounded-lg border border-zinc-800 bg-black/20 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Next</div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{nextActionText(ownerStepRequired, isAuthenticated, step, source)}</p>
            </div>
            {existingValidation?.warnings?.length ? <WarningList warnings={existingValidation.warnings} compact /> : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

function VariableGroup({
  title,
  names,
  values,
  onChange,
}: {
  title: string;
  names: string[];
  values: Record<string, string>;
  onChange: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  if (!names.length) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">{title}</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        {names.map(name => (
          <label key={name} className="block text-xs font-bold uppercase tracking-wider text-zinc-500">
            {name}
            <input
              type={sensitivePattern.test(name) ? 'password' : 'text'}
              value={values[name] || ''}
              onChange={event => onChange(prev => ({ ...prev, [name]: event.target.value }))}
              className="mt-2 w-full rounded border border-zinc-800 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-orange-500"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function StepperItem({
  index,
  active,
  complete,
  title,
  description,
}: {
  index: number;
  active: boolean;
  complete: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className={`flex min-w-[210px] items-start gap-3 rounded-lg border p-3 lg:min-w-0 ${active ? 'border-orange-500/40 bg-orange-500/10' : complete ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-800 bg-black/10'}`}>
      <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${complete ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : active ? 'border-orange-500/50 bg-orange-500/10 text-orange-300' : 'border-zinc-800 bg-zinc-950 text-zinc-500'}`}>
        {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
      </div>
      <div className="min-w-0">
        <div className={`text-xs font-semibold ${active ? 'text-white' : 'text-zinc-300'}`}>{title}</div>
        <div className="mt-1 hidden text-xs leading-5 text-zinc-500 lg:block">{description}</div>
      </div>
    </div>
  );
}

function SourceCard({
  option,
  active,
  onClick,
}: {
  option: (typeof sourceOptions)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = option.icon;
  return (
    <button type="button" onClick={onClick} className={`rounded-lg border p-4 text-left transition-colors ${active ? 'border-orange-500/40 bg-orange-500/10' : 'border-zinc-800 bg-black/20 hover:border-zinc-700'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${active ? 'border-orange-500/30 bg-orange-500/10 text-orange-300' : 'border-zinc-800 bg-zinc-950 text-zinc-500'}`}>
          <Icon className="h-4 w-4" />
        </div>
        {option.badge ? <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300">{option.badge}</span> : null}
      </div>
      <div className="mt-3 text-sm font-semibold text-white">{option.title}</div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{option.description}</p>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
      {label}
      <input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded border border-zinc-800 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500"
      />
    </label>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'success';
}) {
  const color = tone === 'success' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-orange-600 hover:bg-orange-500';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`rounded px-4 py-2 text-xs font-bold uppercase text-white ${color} disabled:cursor-not-allowed disabled:opacity-60`}>
      {children}
    </button>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">{label}</div>
      <div className={`mt-1 break-words text-sm text-zinc-300 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

function StatusList({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => typeof value !== 'object' || value === null);
  const actions = Array.isArray(data.recommendedActions) ? data.recommendedActions.map(String) : [];
  return (
    <div className="mt-5 space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded border border-zinc-800 bg-black/20 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">{key}</div>
            <div className="mt-1 text-sm text-zinc-300">{String(value)}</div>
          </div>
        ))}
      </div>
      {actions.length ? <WarningList warnings={actions} compact /> : null}
    </div>
  );
}

function ValidationCard({ validation }: { validation: ExistingValidation }) {
  const checks = Object.entries(validation.checks || {});
  return (
    <div className={`rounded-lg border p-4 ${validation.ok ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-yellow-500/20 bg-yellow-500/10'}`}>
      <div className={`text-sm font-semibold ${validation.ok ? 'text-emerald-200' : 'text-yellow-200'}`}>
        {validation.ok ? 'Existing server data is ready to attach' : 'Review this folder before attaching'}
      </div>
      {validation.error ? <p className="mt-2 text-xs text-yellow-100/80">{validation.error}</p> : null}
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        {checks.map(([key, ok]) => (
          <div key={key} className="flex items-center gap-2 rounded border border-black/20 bg-black/20 px-3 py-2 text-xs text-zinc-200">
            {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <AlertTriangle className="h-3.5 w-3.5 text-yellow-300" />}
            {key}
          </div>
        ))}
      </div>
      {validation.warnings?.length ? <WarningList warnings={validation.warnings} compact /> : null}
    </div>
  );
}

function WarningList({ warnings, compact }: { warnings: string[]; compact?: boolean }) {
  return (
    <div className={`${compact ? 'mt-3' : 'mt-3'} space-y-2`}>
      {warnings.map(warning => (
        <div key={warning} className="flex items-start gap-2 rounded border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
          {warning}
        </div>
      ))}
    </div>
  );
}

function nextActionText(ownerStepRequired: boolean, isAuthenticated: boolean, step: number, source: DeploymentSource) {
  if (ownerStepRequired) return 'Create the owner account to unlock deployment choices.';
  if (!isAuthenticated) return 'Sign in with the owner account to continue setup.';
  if (step <= 1) return 'Run the environment check. It only reads current status and does not change files.';
  if (step === 2 && source === 'existing-data') return 'Validate your server-data folder, then attach it without running recipe tasks.';
  if (step === 2) return 'Inspect the recipe so Portside can collect required variables.';
  if (step === 3) return 'Fill required variables, then create a safe deployment plan.';
  if (step === 4) return 'Review the file impact summary before applying the deployment.';
  return 'Complete setup to hide onboarding and use Portside normally.';
}
