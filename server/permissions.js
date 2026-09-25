'use strict';

// Every role in the shop. `rank` decides who may manage whom:
// a user may only create/edit accounts with a strictly lower rank.
const ROLES = {
  owner:            { label: 'Owner',            rank: 100, color: '#b8336a' },
  manager:          { label: 'Manager',          rank: 80,  color: '#7b4bb7' },
  cashier:          { label: 'Cashier',          rank: 40,  color: '#1f8a70' },
  cook:             { label: 'Cook',             rank: 30,  color: '#d9822b' },
  kitchen_staff:    { label: 'Kitchen Staff',    rank: 20,  color: '#c0692a' },
  customer_service: { label: 'Customer Service', rank: 20,  color: '#2b7bd9' },
};

// Grouped permission catalogue (drives the owner's Roles & Access screen).
const PERMISSION_GROUPS = [
  { group: 'Dashboard', items: [
    ['dashboard.financials', 'See money figures (sales, expenses, profit) on dashboard'],
  ] },
  { group: 'Items & Stock', items: [
    ['items.view', 'View items, prices and stock'],
    ['items.manage', 'Add / edit / delete items and prices'],
    ['stock.adjust', 'Record stock in / out / wastage'],
  ] },
  { group: 'Production', items: [
    ['production.view', 'View production & sales-count logs'],
    ['production.log', 'Log items made (own entries)'],
    ['production.sales', 'Update end-of-day sold / wasted counts'],
    ['production.manage', 'Edit or delete anyone\'s production entries'],
  ] },
  { group: 'Daily Closing', items: [
    ['closing.view', 'View daily closings (cash / online)'],
    ['closing.create', 'Create / edit today\'s closing'],
    ['closing.manage', 'Edit any date and delete closings'],
  ] },
  { group: 'Expenses', items: [
    ['expenses.view', 'View expense transactions'],
    ['expenses.create', 'Record new expenses'],
    ['expenses.manage', 'Edit / delete any expense'],
  ] },
  { group: 'Vendors', items: [
    ['vendors.view', 'View vendors and pending amounts'],
    ['vendors.manage', 'Add / edit / delete vendors'],
    ['vendors.bills', 'Record vendor bills (purchases on credit)'],
    ['vendors.payments', 'Record payments to vendors'],
    ['documents.view', 'View / download vendor invoices & documents'],
    ['documents.upload', 'Upload vendor invoices & documents'],
  ] },
  { group: 'Customer Orders', items: [
    ['orders.view', 'View cake orders & bookings'],
    ['orders.manage', 'Create / edit / cancel orders'],
    ['orders.status', 'Update order status (kitchen progress)'],
  ] },
  { group: 'Reports', items: [
    ['reports.view', 'Monthly history & reports'],
  ] },
  { group: 'Administration', items: [
    ['users.manage', 'Manage staff accounts (lower roles only)'],
    ['settings.manage', 'Shop settings & categories'],
    ['audit.view', 'View activity log'],
  ] },
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.items.map(i => i[0]));

const DEFAULT_ROLE_PERMISSIONS = {
  manager: ALL_PERMISSIONS.filter(p => !['settings.manage', 'audit.view'].includes(p)),
  cashier: [
    'items.view', 'production.view', 'production.sales',
    'closing.view', 'closing.create', 'expenses.view', 'expenses.create',
    'vendors.view', 'vendors.payments', 'documents.view', 'documents.upload',
    'orders.view', 'orders.manage',
  ],
  cook: [
    'items.view', 'stock.adjust', 'production.view', 'production.log',
    'orders.view', 'orders.status',
  ],
  kitchen_staff: [
    'items.view', 'stock.adjust', 'production.view', 'production.log',
    'orders.view', 'orders.status',
  ],
  customer_service: [
    'items.view', 'production.view', 'production.sales',
    'orders.view', 'orders.manage',
  ],
};

module.exports = { ROLES, PERMISSION_GROUPS, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS };
