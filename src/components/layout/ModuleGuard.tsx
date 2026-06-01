"use client";

/**
 * ModuleGuard — HOC + Wrapper for Dynamic Module Loading
 * ---
 * Prevents rendering (and loading) of any UI that belongs to a disabled module.
 *
 * Three usage patterns:
 *
 * 1. Inline guard (returns null if disabled):
 *    <ModuleGuard module="dental_chart">
 *      <DentalChart />
 *    </ModuleGuard>
 *
 * 2. With fallback UI:
 *    <ModuleGuard module="lab_integration" fallback={<UpgradePrompt />}>
 *      <LabOrders />
 *    </ModuleGuard>
 *
 * 3. HOC wrapping a page component:
 *    export default withModule("dental_chart")(DentalChartPage);
 */

import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import type { ClinicModuleKey } from "@/types/modules";

// =============================================================================
// Skeleton shown while lazy-loaded module chunk is downloading
// =============================================================================
function ModuleSkeleton() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-slate-border bg-surface-card p-8">
      <div className="flex flex-col items-center gap-3 text-slate-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        <span className="text-sm">جارٍ تحميل الوحدة...</span>
      </div>
    </div>
  );
}

// =============================================================================
// ModuleDisabled — shown when module is not in the clinic's plan
// =============================================================================
function ModuleDisabled({ moduleKey }: { moduleKey: ClinicModuleKey }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-border bg-surface-card/50 p-8 text-center">
      <div className="flex flex-col items-center gap-2 text-slate-muted">
        <span className="text-2xl">🔒</span>
        <p className="text-sm font-medium">هذه الوحدة غير مفعّلة لعيادتك</p>
        <p className="text-xs opacity-70">
          ({moduleKey}) — يمكن تفعيلها من إعدادات العيادة
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Core guard component
// =============================================================================
interface ModuleGuardProps {
  /** The module key that must be enabled */
  module: ClinicModuleKey;
  children: ReactNode;
  /** Rendered when module is disabled (defaults to null — completely hidden) */
  fallback?: ReactNode;
  /** Show the locked state UI instead of hiding (useful for settings page) */
  showLocked?: boolean;
  /** Show a loading skeleton while checking module state */
  showSkeleton?: boolean;
}

export function ModuleGuard({
  module,
  children,
  fallback = null,
  showLocked = false,
  showSkeleton = false,
}: ModuleGuardProps) {
  const { hasModule, loading } = useClinicModules();

  if (loading) {
    return showSkeleton ? <ModuleSkeleton /> : null;
  }

  if (!hasModule(module)) {
    if (showLocked) return <ModuleDisabled moduleKey={module} />;
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// =============================================================================
// withModule — HOC for wrapping entire page components
// Usage: export default withModule("dental_chart")(DentalChartPage)
// =============================================================================
export function withModule<P extends object>(moduleKey: ClinicModuleKey) {
  return function ModuleWrapper(WrappedComponent: ComponentType<P>) {
    function GuardedComponent(props: P) {
      const { hasModule, loading } = useClinicModules();

      if (loading) return <ModuleSkeleton />;

      if (!hasModule(moduleKey)) {
        return (
          <div className="flex min-h-[60vh] items-center justify-center p-8">
            <ModuleDisabled moduleKey={moduleKey} />
          </div>
        );
      }

      return <WrappedComponent {...props} />;
    }

    GuardedComponent.displayName = `withModule(${moduleKey})`;
    return GuardedComponent;
  };
}

// =============================================================================
// lazyModule — Lazy-load a component only when the module is enabled
// Combines React.lazy + ModuleGuard so the JS chunk is never downloaded
// when the module is off.
//
// Usage:
//   const DentalChart = lazyModule("dental_chart", () => import("@/components/dental/DentalChart"));
//   <DentalChart patientId={id} />
// =============================================================================
export function lazyModule<P extends object>(
  moduleKey: ClinicModuleKey,
  importFn: () => Promise<{ default: ComponentType<P> }>
) {
  // Lazy component — Next.js will code-split this automatically
  const LazyComponent = lazy(importFn);

  function LazyModuleComponent(props: P) {
    const { hasModule, loading } = useClinicModules();

    if (loading) return <ModuleSkeleton />;
    if (!hasModule(moduleKey)) return null;

    return (
      <Suspense fallback={<ModuleSkeleton />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  }

  LazyModuleComponent.displayName = `lazyModule(${moduleKey})`;
  return LazyModuleComponent;
}

// =============================================================================
// useModuleNav — filter a nav array based on enabled modules
// =============================================================================
export { useModuleNav } from "@/hooks/useModuleNav";
