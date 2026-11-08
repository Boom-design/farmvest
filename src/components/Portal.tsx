import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

type PortalProps = {
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>;

/**
 * Renders its children into document.body instead of where it sits.
 *
 * Every dialog in FarmVest needs this, and none of them worked without it.
 * Ionic gives ion-header z-index 10 and ion-content z-index 0, and both are
 * stacking contexts. A dialog written inside a page therefore lives inside
 * ion-content, where its own z-index only ranks it against its siblings: the
 * whole content layer still paints under the header, so a modal claiming
 * z-index 3000 was still covered by the toolbar, and by the account menu, which
 * already portalled itself out for exactly this reason.
 *
 * Escaping to document.body puts the dialog beside ion-app rather than inside
 * it, and the z-index in the stylesheet finally means what it says.
 */
const Portal: React.FC<PortalProps> = ({ children, ...rest }) =>
  createPortal(<div {...rest}>{children}</div>, document.body);

export default Portal;
