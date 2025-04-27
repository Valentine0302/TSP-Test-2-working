# Freight Calculator - Quick Access Guide

This guide provides simple instructions for accessing and using your Freight Calculator application after deployment on Render.

## Accessing Your Application

### Public Calculator

After deployment, your Freight Calculator will be available at:

```
https://freight-calculator.onrender.com
```

(Note: The exact URL will depend on the name you chose during deployment)

### Admin Dashboard

The admin dashboard is available at:

```
https://freight-calculator.onrender.com/admin
```

You will need to enter the admin username and password you set during deployment.

## Using the Freight Calculator

### Calculating Freight Rates

1. Open the application URL in your browser
2. Fill in the form:
   - Select an origin port
   - Select a destination port
   - Choose a container type
   - Enter your email address
3. Click "Calculate Rate"
4. View the results showing:
   - Average rate
   - Rate range (minimum to maximum)
   - Reliability score
   - Number of data sources used

### Admin Dashboard Features

The admin dashboard provides:

1. **Overview Statistics**:
   - Total calculations
   - Average rate
   - Unique users

2. **Recent Calculations**:
   - Table of recent freight rate calculations
   - Details including routes, rates, and reliability

3. **Analytics**:
   - Popular routes
   - Container type distribution

## Environment Variables

Your application uses these environment variables:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| DATABASE_URL | PostgreSQL connection string | postgres://username:password@host:port/database_name |
| ADMIN_USERNAME | Username for admin access | admin |
| ADMIN_PASSWORD | Password for admin access | secure_password |

## Important Files

If you need to modify the application, these are the key files:

- `server.js` - Main application logic
- `public/index.html` - Main calculator page
- `public/admin.html` - Admin dashboard
- `public/script.js` - Frontend JavaScript
- `public/styles.css` - CSS styles

## Getting Help

If you encounter any issues:

1. Check the documentation files:
   - `RENDER_DEPLOYMENT.md` - Deployment instructions
   - `DATABASE_CONFIG.md` - Database information
   - `MONITORING_MAINTENANCE.md` - Monitoring and maintenance

2. Contact support:
   - Email: support@tsp-transport.com

## Next Steps

Consider these enhancements for your application:

1. **Custom Domain**: Set up a custom domain for a more professional look
2. **Additional Container Types**: Add more container types to the database
3. **Email Notifications**: Implement email notifications for calculation results
4. **Data Source Integration**: Connect to real freight rate APIs for live data

## Quick Troubleshooting

- **Application not loading**: Check if the service is running in Render Dashboard
- **Database errors**: Verify DATABASE_URL environment variable is correct
- **Admin access issues**: Check ADMIN_USERNAME and ADMIN_PASSWORD variables
