import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Landing from '../Landing';

let mockConversation: Record<string, unknown> | null = null;
let mockStartupConfig: Record<string, unknown> = { interface: {} };

jest.mock('@react-spring/web', () => ({
  easings: {
    easeOutCubic: jest.fn(),
  },
}));

jest.mock('librechat-data-provider', () => ({
  EModelEndpoint: {
    azureOpenAI: 'azureOpenAI',
    openAI: 'openAI',
  },
}));

jest.mock(
  '@librechat/client',
  () => ({
    BirthdayIcon: () => <span data-testid="birthday-icon" />,
    TooltipAnchor: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    SplitText: ({ text }: { text: string }) => <span>{text}</span>,
  }),
  { virtual: true },
);

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: mockConversation }),
  useAgentsMapContext: () => undefined,
  useAssistantsMapContext: () => undefined,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
  useGetEndpointsQuery: () => ({ data: {} }),
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { name: 'Henry' } }),
  useLocalize: () => (key: string) => {
    const translations: Record<string, string> = {
      com_ui_how_can_i_help: 'How can I help you today?',
    };
    return translations[key] || key;
  },
}));

jest.mock('~/utils', () => ({
  CONFIG_HTML_MEDIA_ATTR: {},
  CONFIG_HTML_MEDIA_TAGS: [],
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
  createConfigHtmlSanitizer: () => (html: string) => html,
  getIconEndpoint: ({ endpoint }: { endpoint: string }) => endpoint,
  getModelSpec: ({ specName }: { specName?: string }) =>
    specName === 'gpt-5-5'
      ? { name: 'gpt-5-5', label: 'GPT-5.5', showOnLanding: true }
      : undefined,
  getEntity: () => ({ entity: undefined, isAgent: false, isAssistant: false }),
}));

jest.mock('~/components/Endpoints/ConvoIcon', () => () => <span data-testid="convo-icon" />);

describe('Landing greeting', () => {
  beforeEach(() => {
    mockConversation = null;
    mockStartupConfig = { interface: {} };
  });

  it('shows the default "How can I help you today?" greeting for a plain model conversation', () => {
    mockConversation = { endpoint: 'openAI' };
    render(<Landing centerFormOnLanding={false} />);
    expect(screen.getByText('How can I help you today?')).toBeInTheDocument();
  });

  it('does not show the model spec label as the heading, even when showOnLanding is set', () => {
    mockConversation = { endpoint: 'openAI', spec: 'gpt-5-5' };
    render(<Landing centerFormOnLanding={false} />);
    expect(screen.queryByText('GPT-5.5')).not.toBeInTheDocument();
    expect(screen.getByText('How can I help you today?')).toBeInTheDocument();
  });

  it('still respects an admin-configured custom welcome message', () => {
    mockConversation = { endpoint: 'openAI' };
    mockStartupConfig = { interface: { customWelcome: 'Welcome to Nexus AI!' } };
    render(<Landing centerFormOnLanding={false} />);
    expect(screen.getByText('Welcome to Nexus AI!')).toBeInTheDocument();
  });
});
