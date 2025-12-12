import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import { apiRoot } from "./ct-client.js";

const app = express();

app.use(bodyParser.json());
app.use(session({
  secret: "your-secret",
  resave: false,
  saveUninitialized: true
}));

// Mock login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === "admin" && password === "123") {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Invalid credentials" });
});

// Admin check
function isAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}

// Get products with variants and prices
app.get("/admin/products", isAdmin, async (req, res) => {
  try {
    const result = await apiRoot.products().get().execute();
    res.json(result.body.results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a price
app.post("/admin/update-price", isAdmin, async (req, res) => {
  try {
    const { productId, variantId, priceId, centAmount, currency, country } = req.body;

    const product = await apiRoot
      .products()
      .withId({ ID: productId })
      .get()
      .execute();

    const version = product.body.version;

    const response = await apiRoot
      .products()
      .withId({ ID: productId })
      .post({
        body: {
          version: version,
          actions: [
            {
              action: "changePrice",
              priceId,
              price: {
                value: {
                  centAmount,
                  currencyCode: currency
                },
                country: country
              }
            }
          ]
        }
      })
      .execute();

    res.json({ success: true, data: response.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(4000, () => console.log("Backend running on port 4000"));
