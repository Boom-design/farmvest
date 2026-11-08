import { IonContent, IonPage } from '@ionic/react';
import './Skeleton.css';

type SkeletonProps = {
  /** How many placeholder rows to draw. */
  rows?: number;
};

/**
 * Placeholder rows shown while a panel's data loads. Shaped like the table or
 * list it stands in for, so the layout does not jump when the data arrives.
 */
const Skeleton = ({ rows = 4 }: SkeletonProps) => (
  <div className="skeleton" role="status" aria-label="Loading">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="skeleton__row">
        <span className="skeleton__bar skeleton__bar--avatar" />
        <span className="skeleton__lines">
          <span className="skeleton__bar skeleton__bar--title" />
          <span className="skeleton__bar skeleton__bar--meta" />
        </span>
        <span className="skeleton__bar skeleton__bar--cell" />
      </div>
    ))}
  </div>
);

/**
 * A whole dashboard page in outline: header, stat cards and a panel. Used
 * while the session is still being read, before the page itself can render.
 */
export const PageSkeleton = () => (
  <IonPage>
    <IonContent>
      <div className="skeleton-page" role="status" aria-label="Loading">
        <span className="skeleton__bar skeleton__bar--heading" />
        <span className="skeleton__bar skeleton__bar--subheading" />
        <div className="skeleton-page__stats">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index} className="skeleton__bar skeleton__bar--stat" />
          ))}
        </div>
        <div className="skeleton-page__panel">
          <Skeleton rows={5} />
        </div>
      </div>
    </IonContent>
  </IonPage>
);

export default Skeleton;
