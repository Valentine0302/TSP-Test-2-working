# Freight Calculator - Render Deployment Guide

This guide provides simple step-by-step instructions for deploying the Freight Calculator application on Render.

## Prerequisites

- A GitHub account
- A Render account (free tier is sufficient)

## Step 1: Create a GitHub Repository

1. Go to [GitHub](https://github.com) and sign in to your account
2. Click the "+" icon in the top-right corner and select "New repository"
3. Name your repository (e.g., "freight-calculator")
4. Make sure the repository is set to "Public"
5. Click "Create repository"
6. Upload all the project files to this repository

## Step 2: Set Up a PostgreSQL Database on Render

1. Log in to your [Render Dashboard](https://dashboard.render.com)
2. Click on "New" and select "PostgreSQL"
3. Fill in the following details:
   - Name: `freight-calculator-db`
   - Database: `freight_calculator`
   - User: Leave as default
   - Region: Choose the region closest to your users
   - PostgreSQL Version: 14
   - Instance Type: Free
4. Click "Create Database"
5. Once created, note down the following information:
   - Internal Database URL
   - External Database URL
   - Username
   - Password

## Step 3: Deploy the Web Service on Render

1. In your Render Dashboard, click on "New" and select "Web Service"
2. Connect your GitHub repository:
   - Select "GitHub" as the deployment option
   - Connect your GitHub account if not already connected
   - Select the repository you created in Step 1
3. Configure the web service:
   - Name: `freight-calculator`
   - Region: Choose the same region as your database
   - Branch: `main` (or your default branch)
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: Free
4. Add the following environment variables:
   - `DATABASE_URL`: Paste the External Database URL from Step 2
   - `ADMIN_USERNAME`: Choose an admin username (e.g., `admin`)
   - `ADMIN_PASSWORD`: Choose a secure admin password
5. Click "Create Web Service"

## Step 4: Wait for Deployment

1. Render will now build and deploy your application
2. This process typically takes 2-5 minutes
3. You can monitor the deployment progress in the Render Dashboard

## Step 5: Access Your Application

1. Once deployment is complete, Render will provide a URL for your application
   - It will look like `https://freight-calculator.onrender.com`
2. Click on the URL to access your Freight Calculator
3. To access the admin dashboard, go to `https://freight-calculator.onrender.com/admin`
   - Use the admin username and password you set in Step 3

## Troubleshooting

If you encounter any issues during deployment:

1. **Database Connection Issues**:
   - Verify that the `DATABASE_URL` environment variable is correct
   - Make sure your database is running (check status in Render Dashboard)

2. **Build Failures**:
   - Check the build logs in the Render Dashboard
   - Ensure all files were properly uploaded to GitHub

3. **Application Errors**:
   - Check the logs in the Render Dashboard
   - The application automatically initializes the database on first run

## Updating Your Application

To update your application after making changes:

1. Push the changes to your GitHub repository
2. Render will automatically detect the changes and redeploy your application

## Custom Domain (Optional)

To use a custom domain with your application:

1. In the Render Dashboard, go to your web service
2. Click on "Settings" and scroll to "Custom Domain"
3. Follow the instructions to add and verify your domain

## Need Help?

If you need assistance with your deployment, contact:
- Technical Support: support@tsp-transport.com
