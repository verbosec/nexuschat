import { useParams } from 'react-router-dom';
import PlansView from '~/components/Plans/PlansView';
import useAuthRedirect from './useAuthRedirect';

export default function Plans() {
  const { planCode } = useParams();
  const { isAuthenticated } = useAuthRedirect();

  if (!isAuthenticated) {
    return null;
  }

  return <PlansView planCode={planCode} />;
}
