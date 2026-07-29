# KoMart

**KoMart** is a modern retail management system for a Korean and Asian snacks and food store. It provides a full-featured point-of-sale, inventory, purchasing, customer, and reporting platform — built with a React frontend and designed to connect to a FastAPI backend.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Repository Structure](#repository-structure)
- [Frontend](#frontend)
  - [Tech Stack](#tech-stack)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Development Server](#running-the-development-server)
  - [Building for Production](#building-for-production)
  - [Environment Variables](#environment-variables)
  - [Demo Credentials](#demo-credentials)
  - [Project Structure](#project-structure)
  - [Available Scripts](#available-scripts)
- [Connecting to the Backend](#connecting-to-the-backend)
- [Features](#features)

---

## Project Overview

KoMart is built to manage the day-to-day operations of a Korean and Asian grocery/snack retail store, including:

- Point of Sale (POS) with cash, card, eSewa, and Khalti payment support
- Product and inventory management with batch and expiry tracking
- Supplier and purchase order management
- Customer loyalty and membership tiers
- Sales, inventory, and financial reports
- Real-time low-stock and expiry notifications

---

## Repository Structure

```
KoMart/
└── frontend/       # React 19 + TypeScript + Vite frontend application
```

> A `backend/` directory (FastAPI) will be added in a future phase.

---

## Frontend

The frontend is a modern single-page application built with React 19, TypeScript, and Material UI.

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build Tool | Vite 8 |
| UI Library | Material UI (MUI) v9 |
| Routing | React Router v7 |
| Server State | TanStack Query (React Query) v5 |
| Client State | Zustand v5 |
| Charts | Recharts v3 |
| HTTP Client | Axios |
| Forms | React Hook Form + Zod |
| Date Handling | Day.js |

---

### Prerequisites

Make sure you have the following installed before starting:

- [Node.js](https://nodejs.org/) **v18 or higher** (v20+ recommended)
- [npm](https://www.npmjs.com/) **v9 or higher** (comes with Node.js)

Verify your versions:

```bash
node -v
npm -v
```

---

### Installation

1. **Clone the repository** (or open the folder in your IDE):

```bash
git clone <your-repo-url>
cd KoMart
```

2. **Navigate to the frontend directory:**

```bash
cd frontend
```

3. **Install dependencies:**

```bash
npm install
```

---

### Running the Development Server

Start the local development server with hot-module replacement:

```bash
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173).

> By default the app runs with **mock data** (`VITE_USE_MOCK=true`), so no backend is needed to explore the UI.

---

### Building for Production

Compile TypeScript and bundle the app for production:

```bash
npm run build
```

Output is written to `frontend/dist/`.

To preview the production build locally:

```bash
npm run preview
```

The preview server runs at [http://localhost:4173](http://localhost:4173).

---

### Environment Variables

The frontend reads its configuration from `frontend/.env`. A default `.env` file is already included:

```env
VITE_API_BASE_URL=/api/v1
VITE_USE_MOCK=true
```

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Base URL for all API requests |
| `VITE_USE_MOCK` | `true` | `true` uses local mock data; `false` calls the real FastAPI backend |

To switch to a live backend, create a `frontend/.env.local` file and override:

```env
VITE_USE_MOCK=false
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

> Vite also proxies any request starting with `/api` to `http://localhost:8000`, so you can leave `VITE_API_BASE_URL=/api/v1` and just run the FastAPI server on port 8000.

---

### Demo Credentials

When `VITE_USE_MOCK=true`, use these credentials to log in:

| Field | Value |
|---|---|
| Email | `admin@komart.com` |
| Password | `password` |

---

### Project Structure

```
frontend/
├── public/                 # Static assets
├── src/
│   ├── assets/             # Images, fonts, icons
│   ├── components/
│   │   ├── common/         # StatCard, SearchBar, ConfirmDialog, FormModal,
│   │   │                   # DateRangePicker, NotificationPanel, PageHeader,
│   │   │                   # NepaliAwareDatePicker
│   │   ├── charts/         # ChartCard and chart wrappers
│   │   ├── dashboard/      # Dashboard-specific widgets
│   │   ├── forms/          # Reusable form field components
│   │   ├── tables/         # DataTable with sorting and pagination
│   │   └── pos/            # POS-specific components
│   ├── pages/
│   │   ├── auth/           # LoginPage, ForgotPasswordPage
│   │   ├── dashboard/      # DashboardPage
│   │   ├── pos/            # POS page (scaffolded)
│   │   ├── products/       # Product list, form, detail (scaffolded)
│   │   ├── inventory/      # Inventory dashboard and table (scaffolded)
│   │   ├── suppliers/      # Supplier list and detail (scaffolded)
│   │   ├── purchase-orders/ # PO list, create, detail (scaffolded)
│   │   ├── customers/      # Customer list and detail (scaffolded)
│   │   ├── reports/        # Sales, inventory, financial reports (scaffolded)
│   │   ├── notifications/  # Notification center (scaffolded)
│   │   └── settings/       # Store settings (scaffolded)
│   ├── layouts/
│   │   ├── MainLayout.tsx  # App shell with sidebar + topbar
│   │   ├── AuthLayout.tsx  # Centered card layout for auth pages
│   │   ├── Sidebar.tsx     # Collapsible navigation sidebar
│   │   └── TopBar.tsx      # Top navigation with theme toggle + notifications
│   ├── routes/
│   │   ├── index.tsx       # React Router config
│   │   └── guards.tsx      # ProtectedRoute and GuestRoute
│   ├── hooks/
│   │   ├── queryClient.ts  # TanStack Query client config
│   │   ├── useDashboard.ts # Dashboard data hooks
│   │   └── useMediaQuery.ts # Responsive breakpoint hooks
│   ├── services/
│   │   ├── apiClient.ts    # Axios instance with auth interceptors
│   │   ├── index.ts        # All service modules (auth, products, etc.)
│   │   └── mock/           # Mock API and dummy data
│   ├── store/
│   │   └── index.ts        # Zustand stores (auth, theme, UI, cart, dashboard)
│   ├── types/
│   │   └── index.ts        # All TypeScript interfaces and types
│   ├── utils/
│   │   └── index.ts        # Currency, date formatters, cart helpers
│   ├── constants/
│   │   └── index.ts        # Nav items, query keys, app constants
│   ├── theme/
│   │   └── index.ts        # MUI light/dark theme factory
│   ├── App.tsx             # Root component (QueryClient + Theme + Router)
│   ├── main.tsx            # React DOM entry point
│   └── vite-env.d.ts       # Vite environment type declarations
├── .env                    # Default environment variables
├── index.html              # HTML entry point
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
└── package.json
```

---

### Available Scripts

Run all scripts from inside the `frontend/` directory:

| Command | Description |
|---|---|
| `npm run dev` | Start Vite development server at `localhost:5173` |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally at `localhost:4173` |

---

## Backend

The backend is a FastAPI application using MongoDB (via Beanie ODM).

### Backend Tech Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI |
| Database | MongoDB 7 |
| ODM | Beanie (async, Pydantic v2) |
| Auth | JWT (python-jose + passlib) |
| Local Dev | Docker Compose |

### Backend Setup

#### 1. Start MongoDB with Docker

```bash
# From the KoMart root directory
docker compose up -d
```

This starts:
- **MongoDB** on `localhost:27017`
- **Mongo Express** (DB UI) on [http://localhost:8081](http://localhost:8081)

#### 2. Create a Python virtual environment

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

#### 3. Install dependencies

```bash
pip install -r requirements.txt
```

#### 4. Configure environment

```bash
cp .env.example .env
# Edit .env if your MongoDB credentials differ
```

#### 5. Seed the database

```bash
python -m app.seed
```

This populates MongoDB with demo products, customers, suppliers, transactions, and an admin user.

#### 6. Start the API server

```bash
uvicorn app.main:app --reload --port 8000
```

API is available at:
- **API base:** `http://localhost:8000/api/v1`
- **Swagger docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

### API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/forgot-password` | Request password reset |
| GET/POST | `/api/v1/products` | List / Create products |
| GET/PATCH/DELETE | `/api/v1/products/{id}` | Get / Update / Delete product |
| GET | `/api/v1/inventory` | Inventory with batches |
| POST | `/api/v1/inventory/adjust` | Stock adjustment |
| GET/POST | `/api/v1/suppliers` | List / Create suppliers |
| GET/POST | `/api/v1/purchase-orders` | List / Create POs |
| PATCH | `/api/v1/purchase-orders/{id}/status` | Update PO status |
| GET/POST | `/api/v1/customers` | List / Create customers |
| GET | `/api/v1/customers/{id}/transactions` | Customer purchase history |
| POST | `/api/v1/transactions` | Create POS transaction |
| POST | `/api/v1/purchase-orders/{id}/payments` | Record PO payment (creates linked expense) |
| GET | `/api/v1/dashboard/stats` | Dashboard summary |
| GET | `/api/v1/dashboard/revenue` | Revenue trend data |
| GET | `/api/v1/dashboard/top-products` | Top selling products |
| GET | `/api/v1/notifications` | List notifications |
| GET/PATCH | `/api/v1/settings` | Store settings |

### Connect Frontend to Backend

Once the backend is running, update `frontend/.env.local`:

```env
VITE_USE_MOCK=false
VITE_API_BASE_URL=/api/v1
```

Vite proxies `/api` → `http://localhost:8000` automatically.

---

## Connecting to the Backend

The frontend is designed to work with a **FastAPI** backend. When you have the backend running:

1. Start the FastAPI server on port `8000`
2. In `frontend/.env.local`, set:

```env
VITE_USE_MOCK=false
```

3. Restart the Vite dev server — all API calls will be proxied from `/api` to `http://localhost:8000/api`.

All service functions in `src/services/index.ts` automatically switch between the mock layer and the real API based on this flag.

---

## Features

| Module | Status |
|---|---|
| Authentication (Login, Forgot Password) | Done |
| Dashboard (stats, charts, transactions) | Done |
| Point of Sale | Scaffolded |
| Product Management | Scaffolded |
| Inventory Management | Scaffolded |
| Supplier Management | Scaffolded |
| Purchase Orders | Done |
| Customer Management | Scaffolded |
| Reports | Scaffolded |
| Notifications Center | Scaffolded |
| Settings | Scaffolded |
| Light / Dark Mode | Done |
| Responsive Layout (mobile, tablet, desktop) | Done |
| Mock API Layer | Done |
