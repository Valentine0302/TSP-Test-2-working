# Database Configuration for Freight Calculator on Render

This file contains information about the database configuration for the Freight Calculator application deployed on Render.

## Database Schema

The application uses a PostgreSQL database with the following tables:

### calculation_history

Stores the history of all freight rate calculations.

```sql
CREATE TABLE calculation_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  email VARCHAR(255) NOT NULL,
  origin VARCHAR(50) NOT NULL,
  destination VARCHAR(50) NOT NULL,
  container_type VARCHAR(50) NOT NULL,
  rate NUMERIC NOT NULL,
  min_rate NUMERIC NOT NULL,
  max_rate NUMERIC NOT NULL,
  reliability NUMERIC NOT NULL,
  source_count INTEGER NOT NULL
);
```

### ports

Stores information about shipping ports.

```sql
CREATE TABLE ports (
  id VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL,
  region VARCHAR(100) NOT NULL
);
```

### container_types

Stores information about container types.

```sql
CREATE TABLE container_types (
  id VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL
);
```

## Environment Variables

The application requires the following environment variable to connect to the database:

- `DATABASE_URL`: The PostgreSQL connection string provided by Render

Example format:
```
postgres://username:password@host:port/database_name
```

## Database Initialization

The application automatically initializes the database on first run, creating the necessary tables and populating them with initial data. This is handled by the `initializeDatabase()` function in `server.js`.

## Database Backup and Restore

### Creating a Backup

To create a backup of your database on Render:

1. Go to your Render Dashboard
2. Select your PostgreSQL database
3. Go to the "Backups" tab
4. Click "Create Backup"

Render automatically creates daily backups for all PostgreSQL databases.

### Restoring from a Backup

To restore your database from a backup:

1. Go to your Render Dashboard
2. Select your PostgreSQL database
3. Go to the "Backups" tab
4. Find the backup you want to restore
5. Click the "Restore" button next to it

## Database Scaling

The free tier of Render PostgreSQL includes:
- 1GB storage
- Shared CPU
- 256MB RAM

This is sufficient for the initial deployment of the Freight Calculator. If you need to scale up as your usage grows, you can upgrade to a paid plan in the Render Dashboard.

## Connecting to the Database Manually

If you need to connect to the database manually for maintenance or troubleshooting:

1. Install the PostgreSQL client tools on your local machine
2. Use the External Database URL provided by Render:

```bash
psql your_external_database_url
```

Or with individual parameters:

```bash
psql -h host -p port -U username -d database_name
```

When prompted, enter the password provided by Render.

## Common Database Operations

### Viewing Calculation History

```sql
SELECT * FROM calculation_history ORDER BY timestamp DESC LIMIT 100;
```

### Finding Popular Routes

```sql
SELECT origin, destination, COUNT(*) as count 
FROM calculation_history 
GROUP BY origin, destination 
ORDER BY count DESC 
LIMIT 10;
```

### Clearing Old History (if needed)

```sql
DELETE FROM calculation_history WHERE timestamp < NOW() - INTERVAL '6 months';
```

## Troubleshooting Database Issues

If you encounter database connection issues:

1. Verify that the `DATABASE_URL` environment variable is correctly set in your Render web service
2. Check the status of your database in the Render Dashboard
3. Ensure your application has the necessary permissions to access the database
4. Check the logs in the Render Dashboard for specific error messages

For persistent issues, contact Render support or email support@tsp-transport.com for assistance.
