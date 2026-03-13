import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function ChatbotLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/chatbot')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/chatbot') {
      throw redirect({ to: '/chatbot/threads' });
    }
  },
  component: ChatbotLayout,
});
