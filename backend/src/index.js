import express from 'express';
import cors from 'cors';
import ownersRouter from './routes/owners.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/owners', ownersRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
