import { Tabs, TabsList, TabsTrigger } from '@librechat/client';
import { useLocalize } from '~/hooks';

type Interval = 'monthly' | 'annual';

type PlanIntervalSwitcherProps = {
  interval: Interval;
  onChange: (interval: Interval) => void;
  annualSavingsPercent?: number | null;
};

const triggerClassName =
  'rounded-full px-6 py-2 text-sm font-medium text-text-secondary transition-colors data-[state=active]:bg-surface-submit data-[state=active]:text-white data-[state=active]:shadow-sm';

export default function PlanIntervalSwitcher({
  interval,
  onChange,
  annualSavingsPercent,
}: PlanIntervalSwitcherProps) {
  const localize = useLocalize();

  return (
    <Tabs value={interval} onValueChange={(value) => onChange(value as Interval)}>
      <TabsList className="h-12 gap-1 rounded-full border border-border-light bg-surface-secondary p-1">
        <TabsTrigger value="monthly" className={triggerClassName}>
          {localize('com_ui_billing_interval_monthly')}
        </TabsTrigger>
        <TabsTrigger value="annual" className={`group flex items-center gap-2 ${triggerClassName}`}>
          {localize('com_ui_billing_interval_annual')}
          {annualSavingsPercent ? (
            <span
              title={`${annualSavingsPercent}% ${localize('com_ui_billing_annual_savings')}`}
              className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-600 group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white"
            >
              {`-${annualSavingsPercent}%`}
            </span>
          ) : null}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
