import { Navigate, useParams } from 'react-router-dom';
import { Editor } from '@/components/Editor';

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/jobs" replace />;
  return (
    <div className="h-full">
      <Editor source={{ kind: 'job', jobId: id }} />
    </div>
  );
}
