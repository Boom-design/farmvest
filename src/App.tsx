import { Route, Routes } from 'react-router-dom';
import { IonApp, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import Landing from './pages/Landing';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import CustomerDashboard from './pages/customer/Dashboard';
import AdminDashboard from './pages/AdminDashboard';
import MyProjects from './pages/farmowner/MyProjects';
import RentEquipment from './pages/farmowner/RentEquipment';
import MyRentals from './pages/farmowner/MyRentals';
import ProgressUpdates from './pages/farmowner/ProgressUpdates';
import WeatherAdvisory from './pages/farmowner/WeatherAdvisory';
import CustomerReports from './pages/customer/Reports';
import BrowseProjects from './pages/investor/BrowseProjects';
import MyInvestments from './pages/investor/MyInvestments';
import ProgressMonitoring from './pages/investor/ProgressMonitoring';
import UserManagement from './pages/admin/UserManagement';
import LivestockProjects from './pages/admin/LivestockProjects';
import InvestmentTransactions from './pages/admin/InvestmentTransactions';
import EquipmentFleet from './pages/admin/EquipmentFleet';
import RentalBookings from './pages/admin/RentalBookings';
import ReportsDisputes from './pages/admin/ReportsDisputes';
import AccountProfile from './pages/AccountProfile';
import Notifications from './pages/Notifications';
import ProtectedRoute from './components/ProtectedRoute';
import { AppSidebar, SideNavProvider } from './components/SideNav';
import ChatBot from './components/ChatBot';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Dark mode palettes are left out on purpose: FarmVest ships a single light
 * brand palette, defined in theme/variables.css. */

/* Theme variables */
import './theme/variables.css';

setupIonicReact();

const App: React.FC = () => (
  <IonApp>
    <AuthProvider>
      <ToastProvider>
      <IonReactRouter>
        <SideNavProvider>
          <AppSidebar />
          <ChatBot />
          {/* Plain routes, not IonRouterOutlet. The outlet keeps every visited
              page stacked and swaps them with transitions; with ProtectedRoute
              changing its page from the loading state to the real one, and the
              redirects on sign-in, that stack lost track and left the wrong page
              showing until a refresh. A dashboard needs no page transitions. */}
          <div id="main" className="app-main">
          <Routes>
          <Route path="/login" element={<Login />} />

          {/* Registration is the same page in its sign-up mode. Given its own
              route rather than a piece of router state so Get Started has a real
              address: it survives a refresh and can be linked to directly. */}
          <Route path="/register" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />


          {/* One prefix, because there is one non-admin role. The farming and
              investing halves are separated by the sidebar headings rather than
              by the URL: the same person does both, and a customer who had to
              notice which half of the app they were in would be doing the
              product's filing for it. */}
          <Route
            path="/app"
            element={
              <ProtectedRoute allow={['Customer']}>
                <CustomerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/projects"
            element={
              <ProtectedRoute allow={['Customer']}>
                <MyProjects />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/equipment"
            element={
              <ProtectedRoute allow={['Customer']}>
                <RentEquipment />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/rentals"
            element={
              <ProtectedRoute allow={['Customer']}>
                <MyRentals />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/progress"
            element={
              <ProtectedRoute allow={['Customer']}>
                <ProgressUpdates />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/weather"
            element={
              <ProtectedRoute allow={['Customer']}>
                <WeatherAdvisory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/browse"
            element={
              <ProtectedRoute allow={['Customer']}>
                <BrowseProjects />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/investments"
            element={
              <ProtectedRoute allow={['Customer']}>
                <MyInvestments />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/monitoring"
            element={
              <ProtectedRoute allow={['Customer']}>
                <ProgressMonitoring />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/reports"
            element={
              <ProtectedRoute allow={['Customer']}>
                <CustomerReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allow={['Admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute allow={['Admin']}>
                <UserManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/projects"
            element={
              <ProtectedRoute allow={['Admin']}>
                <LivestockProjects />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/investments"
            element={
              <ProtectedRoute allow={['Admin']}>
                <InvestmentTransactions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/equipment"
            element={
              <ProtectedRoute allow={['Admin']}>
                <EquipmentFleet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/rentals"
            element={
              <ProtectedRoute allow={['Admin']}>
                <RentalBookings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <ProtectedRoute allow={['Admin']}>
                <ReportsDisputes />
              </ProtectedRoute>
            }
          />

          <Route
            path="/notifications"
            element={
              <ProtectedRoute allow={['Admin', 'Customer']}>
                <Notifications />
              </ProtectedRoute>
            }
          />

          <Route
            path="/account"
            element={
              <ProtectedRoute allow={['Admin', 'Customer']}>
                <AccountProfile />
              </ProtectedRoute>
            }
          />

          {/* The public catalogue. Signed out is the normal case here, so it sits
              outside ProtectedRoute; Landing itself sends a signed-in visitor on
              to the dashboard their role owns. */}
          <Route path="/" element={<Landing />} />
          </Routes>
          </div>
        </SideNavProvider>
      </IonReactRouter>
      </ToastProvider>
    </AuthProvider>
  </IonApp>
);

export default App;