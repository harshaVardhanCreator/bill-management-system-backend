import express from 'express';
import cors from 'cors';
import ownersRouter from './routes/owners.js';
import tenantsRouter from './routes/tenants.js';
import powerMetersRouter from './routes/powerMeters.js';
import rentHistoryRouter from './routes/rentHistory.js';
import waterHistoryRouter from './routes/waterHistory.js';
import maintenanceHistoryRouter from './routes/maintenanceHistory.js';
import generalSetupRouter from './routes/generalSetup.js';
import monthlyReadingRouter from './routes/monthlyReading.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/owners', ownersRouter);
app.use('/tenants', tenantsRouter);
app.use('/power-meters', powerMetersRouter);
app.use('/rent-history', rentHistoryRouter);
app.use('/water-history', waterHistoryRouter);
app.use('/maintenance-history', maintenanceHistoryRouter);
app.use('/general-setup', generalSetupRouter);
app.use('/monthly-reading', monthlyReadingRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
