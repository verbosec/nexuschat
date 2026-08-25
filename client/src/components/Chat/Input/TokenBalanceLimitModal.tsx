import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ViolationTypes, getRefillEligibilityDate } from 'librechat-data-provider';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  Button,
} from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import { useGetUserBalance, useGetStartupConfig } from '~/data-provider';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useAuthContext } from '~/hooks/AuthContext';
import { extractJson, isJson } from '~/utils/json';
import useLocalize from '~/hooks/useLocalize';

type TokenBalanceLimitModalProps = {
  index: number;
};

function isTokenBalanceError(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const jsonString = extractJson(text);
  if (!isJson(jsonString)) {
    return false;
  }
  const parsed = JSON.parse(jsonString) as { type?: string };
  return parsed.type === ViolationTypes.TOKEN_BALANCE;
}

export default function TokenBalanceLimitModal({ index }: TokenBalanceLimitModalProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const latestMessage: TMessage | null = useLatestMessage(index);
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && !!startupConfig?.balance?.enabled,
  });
  const [open, setOpen] = useState(false);
  const hasSeededRef = useRef(false);
  const suppressedIdRef = useRef<string | null>(null);
  const notifiedIdRef = useRef<string | null>(null);

  if (!hasSeededRef.current) {
    hasSeededRef.current = true;
    if (latestMessage?.error === true && isTokenBalanceError(latestMessage.text)) {
      suppressedIdRef.current = latestMessage.messageId ?? null;
    }
  }

  useEffect(() => {
    const messageId = latestMessage?.messageId;
    if (!messageId) {
      return;
    }
    if (messageId === suppressedIdRef.current || messageId === notifiedIdRef.current) {
      return;
    }
    if (latestMessage?.error === true && isTokenBalanceError(latestMessage.text)) {
      notifiedIdRef.current = messageId;
      setOpen(true);
    }
  }, [latestMessage]);

  const { autoRefillEnabled, refillIntervalValue, refillIntervalUnit, lastRefill } =
    balanceQuery.data ?? {};
  const resetDate =
    autoRefillEnabled === true &&
    lastRefill != null &&
    refillIntervalValue != null &&
    refillIntervalUnit != null
      ? getRefillEligibilityDate(new Date(lastRefill), refillIntervalValue, refillIntervalUnit)
      : null;

  const handleViewPlans = () => {
    setOpen(false);
    navigate('/plans');
  };

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <OGDialogContent className="w-11/12 max-w-md">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_limit_modal_title')}</OGDialogTitle>
        </OGDialogHeader>
        <p className="text-sm text-text-secondary">
          {resetDate
            ? localize('com_ui_limit_modal_body_with_reset', {
                date: resetDate.toLocaleDateString(),
              })
            : localize('com_ui_limit_modal_body')}
        </p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-text-secondary">
          <li>{localize('com_ui_limit_modal_benefit_continue')}</li>
          <li>{localize('com_ui_limit_modal_benefit_allowance')}</li>
          <li>{localize('com_ui_limit_modal_benefit_topup')}</li>
          <li>{localize('com_ui_limit_modal_benefit_manage')}</li>
        </ul>
        <Button variant="submit" onClick={handleViewPlans} className="w-full">
          {localize('com_ui_limit_modal_cta')}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full text-center text-xs text-text-secondary underline"
        >
          {resetDate
            ? localize('com_ui_limit_modal_wait', { date: resetDate.toLocaleDateString() })
            : localize('com_ui_limit_modal_wait_generic')}
        </button>
      </OGDialogContent>
    </OGDialog>
  );
}
