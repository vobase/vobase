import { StreamdownTextPrimitive } from '@assistant-ui/react-streamdown';
import { code } from '@streamdown/code';
import { memo } from 'react';

const plugins = { code };

const StreamdownTextImpl = () => {
  return (
    <StreamdownTextPrimitive
      plugins={plugins}
      shikiTheme={['github-light', 'github-dark']}
      className="aui-md"
    />
  );
};

export const StreamdownText = memo(StreamdownTextImpl);
