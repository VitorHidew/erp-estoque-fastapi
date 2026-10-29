export const state = {
  products: [],
  parties: [],
  orders: [],
  movements: [],
  financeEntries: [],
  financeSummary: null,
  chartAccounts: [],
  costCenters: [],
  pagination: {
    productPage: 1,
    productPageSize: Number(localStorage.getItem("rl_page_size") || 8),
    productTotal: 0,
    orderPage: 1,
    orderPageSize: Number(localStorage.getItem("rl_order_page_size") || 25),
    orderTotal: 0,
    financePage: 1,
    financePageSize: Number(localStorage.getItem("rl_finance_page_size") || 25),
    financeTotal: 0,
  },
};


