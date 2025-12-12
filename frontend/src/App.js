import React, { useEffect, useState } from 'react';
import { apiRoot } from './commercetools-client';
import './App.css';

function App() {
  // --- STATE ---
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState('login'); // Start at Login
  
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(false);

  // Forms
  const [authData, setAuthData] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [newProduct, setNewProduct] = useState({ name: '', price: '' });
  const [editPrice, setEditPrice] = useState({ productId: '', price: '' });
  
  // Checkout
  const [orderStatus, setOrderStatus] = useState(null);
  const [checkoutForm, setCheckoutForm] = useState({ name: '', address: '' });

  // --- INITIAL LOAD ---
  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = () => {
    setLoading(true);
    apiRoot.products().get().execute()
      .then(res => {
        setProducts(res.body.results);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  // --- HELPERS ---
  const getProductName = (p) => {
    // Safely get name
    if (!p.masterData?.current?.name) return "Unnamed";
    return p.masterData.current.name['en-US'] || Object.values(p.masterData.current.name)[0];
  };

  const getProductImage = (p) => p.masterData?.current?.masterVariant?.images?.[0]?.url || "https://via.placeholder.com/300";
  
  const getRawPrice = (p) => {
    const prices = p.masterData?.current?.masterVariant?.prices;
    if (!prices || prices.length === 0) return 0;
    return prices[0].value.centAmount / 100;
  };

  const formatPrice = (amount) => "$" + amount.toFixed(2);

  // --- AUTHENTICATION ---
  const handleAuthInput = (e) => setAuthData({...authData, [e.target.name]: e.target.value});

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRoot.customers().post({
        body: {
          email: authData.email,
          password: authData.password,
          firstName: authData.firstName,
          lastName: authData.lastName
        }
      }).execute();
      loginSuccess(res.body.customer);
      alert("Account Created!");
    } catch (err) {
      alert("Signup Error: " + err.message);
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRoot.login().post({
        body: { email: authData.email, password: authData.password }
      }).execute();
      loginSuccess(res.body.customer);
    } catch (err) {
      alert("Login Failed: " + err.message);
      setLoading(false);
    }
  };

  const loginSuccess = (customerData) => {
    setUser(customerData);
    setLoading(false);
    
    // CHECK FOR ADMIN (Case Insensitive)
    console.log("Logged in as:", customerData.email);
    if (customerData.email.toLowerCase() === "admin@shopswift.com") {
      setIsAdmin(true);
      setActiveTab('admin'); // Go straight to Admin panel
    } else {
      setIsAdmin(false);
      setActiveTab('shop'); // Go to Shop
    }
  };

  const handleLogout = () => {
    setUser(null);
    setIsAdmin(false);
    setCart([]);
    setActiveTab('login');
    setAuthData({ email: '', password: '', firstName: '', lastName: '' });
  };

  // --- CART LOGIC ---
  const addToCart = (product) => {
    const exist = cart.find((x) => x.id === product.id);
    if (exist) {
      setCart(cart.map((x) => x.id === product.id ? { ...exist, quantity: exist.quantity + 1 } : x));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
    // Optional: alert(getProductName(product) + " added!");
  };

  const updateQuantity = (product, change) => {
    const exist = cart.find((x) => x.id === product.id);
    if (exist.quantity + change > 0) {
        setCart(cart.map((x) => x.id === product.id ? { ...exist, quantity: exist.quantity + change } : x));
    } else {
        setCart(cart.filter((x) => x.id !== product.id));
    }
  };

  const calculateTotal = () => cart.reduce((acc, item) => acc + (getRawPrice(item) * item.quantity), 0);

  // --- CHECKOUT LOGIC (REAL) ---
  const submitOrder = async (e) => {
    e.preventDefault();
    setOrderStatus("Processing...");

    try {
        // 1. Create Cart
        const createCartDraft = { currency: "USD" }; // Removed 'country: US' to fix error
        const cartRes = await apiRoot.carts().post({ body: createCartDraft }).execute();
        
        // 2. Add Items
        const actions = cart.map(item => ({
            action: "addLineItem",
            productId: item.id,
            variantId: item.masterData.current.masterVariant.id,
            quantity: item.quantity
        }));

        const updatedCart = await apiRoot.carts().withId({ ID: cartRes.body.id }).post({
            body: { version: cartRes.body.version, actions: actions }
        }).execute();

        // 3. Create Order
        const orderNumber = "ORD-" + Math.floor(Math.random() * 100000);
        await apiRoot.orders().post({
            body: {
                id: cartRes.body.id,
                version: updatedCart.body.version,
                orderNumber: orderNumber
            }
        }).execute();

        setOrderStatus("success");
        setCart([]);
        setTimeout(() => { setOrderStatus(null); setActiveTab('shop'); }, 3000);

    } catch (err) {
        setOrderStatus("error");
        alert("Order Failed: " + err.message);
    }
  };

  // --- ADMIN LOGIC ---
  const handleAddProduct = async (e) => {
    e.preventDefault();
    try {
      // Get Type
      const typeRes = await apiRoot.productTypes().get().execute();
      if(typeRes.body.results.length === 0) throw new Error("No Product Types found. Create one in dashboard first.");
      const typeId = typeRes.body.results[0].id;

      // Create
      const draft = {
        key: "p-" + Math.floor(Math.random()*10000),
        name: { "en-US": newProduct.name },
        productType: { typeId: "product-type", id: typeId },
        slug: { "en-US": "slug-" + Math.floor(Math.random()*10000) },
        masterVariant: {
          sku: "SKU-" + Math.floor(Math.random()*10000),
          prices: [{ value: { currencyCode: "USD", centAmount: parseFloat(newProduct.price) * 100 } }]
        }
      };
      
      const created = await apiRoot.products().post({ body: draft }).execute();
      // Publish
      await apiRoot.products().withId({ ID: created.body.id }).post({
        body: { version: created.body.version, actions: [{ action: "publish" }] }
      }).execute();

      alert("Product Created!");
      setNewProduct({ name: '', price: '' });
      fetchProducts();
    } catch (err) { alert(err.message); }
  };

  const handleUpdatePrice = async (e, productId) => {
    e.preventDefault();
    try {
        const pRes = await apiRoot.products().withId({ ID: productId }).get().execute();
        const product = pRes.body;
        
        await apiRoot.products().withId({ ID: product.id }).post({
            body: {
                version: product.version,
                actions: [{
                    action: "setPrices",
                    variantId: product.masterData.current.masterVariant.id,
                    prices: [{ value: { currencyCode: "USD", centAmount: parseFloat(editPrice.price) * 100 } }]
                }]
            }
        }).execute();

        // Need to fetch again to get new version to publish
        const pRes2 = await apiRoot.products().withId({ ID: productId }).get().execute();
        await apiRoot.products().withId({ ID: productId }).post({
            body: { version: pRes2.body.version, actions: [{ action: "publish" }] }
        }).execute();

        alert("Price Updated!");
        fetchProducts();
    } catch(err) { alert(err.message); }
  };


  // --- VIEWS ---

  const renderAuth = (isSignup) => (
    <div className="auth-container">
      <h2>{isSignup ? "Create Account" : "Sign In"}</h2>
      <form onSubmit={isSignup ? handleSignup : handleLogin} className="auth-form">
        {isSignup && (
          <>
            <input type="text" name="firstName" placeholder="First Name" onChange={handleAuthInput} required />
            <input type="text" name="lastName" placeholder="Last Name" onChange={handleAuthInput} required />
          </>
        )}
        <input type="email" name="email" placeholder="Email (admin@shopswift.com for Admin)" onChange={handleAuthInput} required />
        <input type="password" name="password" placeholder="Password" onChange={handleAuthInput} required />
        <button type="submit" className="submit-btn">{isSignup ? "Sign Up" : "Login"}</button>
      </form>
      <p onClick={() => setActiveTab(isSignup ? 'login' : 'signup')} className="switch-auth">
        {isSignup ? "Already have an account? Login" : "New here? Create Account"}
      </p>
    </div>
  );

  const renderShop = () => (
    <div className="product-grid">
      {products.map((product) => (
        <div key={product.id} className="product-card">
          <div className="image-container"><img src={getProductImage(product)} alt="Product" /></div>
          <div className="card-details">
            <h3>{getProductName(product)}</h3>
            <p className="price">{formatPrice(getRawPrice(product))}</p>
            <button className="add-btn" onClick={() => addToCart(product)}>Add to Cart</button>
          </div>
        </div>
      ))}
    </div>
  );

  const renderCart = () => (
    <div className="cart-container">
      <h2>Your Cart</h2>
      {cart.length === 0 ? <p className="empty-state">Cart is empty.</p> : (
        <>
        {cart.map(item => (
            <div key={item.id} className="cart-item">
                <img src={getProductImage(item)} alt="thumb" />
                <div className="cart-info">
                    <h4>{getProductName(item)}</h4>
                    <p>{formatPrice(getRawPrice(item))}</p>
                </div>
                <div className="quantity-controls">
                    <button onClick={() => updateQuantity(item, -1)}>-</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => updateQuantity(item, 1)}>+</button>
                </div>
                <div className="item-total">{formatPrice(getRawPrice(item) * item.quantity)}</div>
            </div>
        ))}
        <div className="cart-summary">
            <h3>Total: {formatPrice(calculateTotal())}</h3>
            <button className="checkout-btn" onClick={() => setActiveTab('checkout')}>Checkout</button>
        </div>
        </>
      )}
    </div>
  );

  const renderCheckout = () => (
    <div className="checkout-container">
        {orderStatus === "success" ? (
            <div style={{color: "green", textAlign: "center"}}><h2>🎉 Order Placed!</h2></div>
        ) : (
            <form onSubmit={submitOrder} className="checkout-form">
                <h2>Checkout</h2>
                <div className="form-group">
                    <label>Name</label>
                    <input type="text" required value={checkoutForm.name} onChange={e => setCheckoutForm({...checkoutForm, name: e.target.value})} />
                </div>
                <div className="form-group">
                    <label>Address</label>
                    <input type="text" required value={checkoutForm.address} onChange={e => setCheckoutForm({...checkoutForm, address: e.target.value})} />
                </div>
                <p><strong>Total: {formatPrice(calculateTotal())}</strong></p>
                <button type="submit" className="submit-order-btn" disabled={orderStatus === "Processing..."}>
                    {orderStatus === "Processing..." ? "Processing..." : "Confirm Order"}
                </button>
                <button type="button" onClick={() => setActiveTab('cart')} style={{marginTop:'10px', background:'none', border:'none', cursor:'pointer'}}>Cancel</button>
            </form>
        )}
    </div>
  );

  const renderAdmin = () => (
    <div className="admin-dashboard">
      <h2>👑 Admin Dashboard</h2>
      
      <div className="admin-section">
        <h3>Add Product</h3>
        <form onSubmit={handleAddProduct} className="admin-form">
          <input type="text" placeholder="Name" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} />
          <input type="number" placeholder="Price" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} />
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="admin-section">
        <h3>Manage Prices</h3>
        {products.map(p => (
            <div key={p.id} className="admin-row">
                <span>{getProductName(p)}</span>
                <span style={{fontWeight:'bold'}}>{formatPrice(getRawPrice(p))}</span>
                <form onSubmit={(e) => { setEditPrice({...editPrice, productId: p.id}); handleUpdatePrice(e, p.id); }}>
                    <input type="number" placeholder="New Price" onChange={e => setEditPrice({productId: p.id, price: e.target.value})} />
                    <button type="submit">Update</button>
                </form>
            </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="App">
      <nav className="navbar">
        <h1 className="logo">ShopSwift 🚀</h1>
        <div className="nav-links">
          {!user ? (
            <button className="active">Sign In Required</button>
          ) : (
            <>
              <button onClick={() => setActiveTab('shop')} className={activeTab === 'shop' ? 'active' : ''}>Shop</button>
              <button onClick={() => setActiveTab('cart')} className={activeTab === 'cart' ? 'active' : ''}>Cart ({cart.reduce((a,c)=>a+c.quantity,0)})</button>
              {isAdmin && <button onClick={() => setActiveTab('admin')} style={{color:'red', fontWeight:'bold'}}>Admin</button>}
              <button onClick={handleLogout} className="logout-btn">Logout</button>
            </>
          )}
        </div>
      </nav>

      <main className="content">
        {activeTab === 'login' && renderAuth(false)}
        {activeTab === 'signup' && renderAuth(true)}
        {activeTab === 'shop' && renderShop()}
        {activeTab === 'cart' && renderCart()}
        {activeTab === 'checkout' && renderCheckout()}
        {activeTab === 'admin' && renderAdmin()}
      </main>
    </div>
  );
}

export default App;