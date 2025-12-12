import React, { useEffect, useState } from 'react';
import { apiRoot } from './commercetools-client';
// Import AWS SDK
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"; 
import './App.css';

// --- AWS CONFIGURATION ---
const S3_BUCKET_NAME = "YOUR_BUCKET_NAME"; 
const REGION = "us-east-1"; 
const AWS_ACCESS_KEY = "YOUR_ACCESS_KEY"; 
const AWS_SECRET_KEY = "YOUR_SECRET_KEY";
const AWS_SESSION_TOKEN = "YOUR_SESSION_TOKEN"; // If using Learner Lab

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY,
    secretAccessKey: AWS_SECRET_KEY,
    sessionToken: AWS_SESSION_TOKEN 
  }
});

function App() {
  // --- STATE ---
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState('login'); 
  
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  // Forms
  const [authData, setAuthData] = useState({ email: '', password: '', firstName: '', lastName: '' });
  
  // Admin State
  const [newProduct, setNewProduct] = useState({ name: '', price: '', imageUrl: '' });
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [editPrice, setEditPrice] = useState({ productId: '', price: '' });

  // Checkout State
  const [orderStatus, setOrderStatus] = useState(null);
  const [checkoutForm, setCheckoutForm] = useState({ 
      street: 'Hauptstraße 456', 
      city: 'Berlin', 
      zip: '12345'
  });

  // --- INITIAL LOAD ---
  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = () => {
    setLoading(true);
    apiRoot.products().get().execute()
      .then(res => { setProducts(res.body.results); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  };

  const fetchOrders = () => {
    apiRoot.orders().get().execute()
      .then(res => setOrders(res.body.results))
      .catch(err => alert("Error fetching orders: " + err.message));
  };

  // --- HELPERS ---
  const getProductName = (p) => p.masterData?.current?.name['en-US'] || Object.values(p.masterData?.current?.name)[0] || "Unnamed";
  const getProductImage = (p) => p.masterData?.current?.masterVariant?.images?.[0]?.url || "https://via.placeholder.com/300";
  const getRawPrice = (p) => (p.masterData?.current?.masterVariant?.prices?.[0]?.value.centAmount || 0) / 100;
  const formatPrice = (amount) => "$" + amount.toFixed(2);
  const getSku = (p) => p.masterData?.current?.masterVariant?.sku || "SKU-" + p.id.slice(0,5);

  // --- AWS S3 UPLOAD ---
  const handleFileSelect = (e) => setSelectedFile(e.target.files[0]);

  const uploadImageToS3 = async () => {
    if (!selectedFile) return null;
    setUploadStatus("Uploading...");
    const fileName = `${Date.now()}-${selectedFile.name}`;
    const params = { Bucket: S3_BUCKET_NAME, Key: fileName, Body: selectedFile, ContentType: selectedFile.type };
    try {
      await s3Client.send(new PutObjectCommand(params));
      setUploadStatus("Done!");
      return `https://${S3_BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileName}`;
    } catch (err) {
      console.error(err);
      setUploadStatus("Failed");
      return null;
    }
  };

  // --- AUTHENTICATION ---
  const handleAuthInput = (e) => setAuthData({...authData, [e.target.name]: e.target.value});

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRoot.login().post({ body: { email: authData.email, password: authData.password } }).execute();
      const customer = res.body.customer;
      setUser(customer);
      setLoading(false);
      
      if (customer.email.toLowerCase() === "admin@shopswift.com") {
        setIsAdmin(true);
        fetchOrders();
        setActiveTab('admin'); 
      } else {
        setIsAdmin(false);
        setActiveTab('shop'); 
      }
    } catch (err) { alert("Login Failed: " + err.message); setLoading(false); }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
        await apiRoot.customers().post({
            body: { email: authData.email, password: authData.password, firstName: authData.firstName, lastName: authData.lastName }
        }).execute();
        alert("Account Created! Please Login.");
        setLoading(false);
        setActiveTab('login');
    } catch (err) { alert(err.message); setLoading(false); }
  };

  const handleLogout = () => { setUser(null); setIsAdmin(false); setCart([]); setActiveTab('login'); };

  // --- CART ACTIONS ---
  const addToCart = (product) => {
    const exist = cart.find((x) => x.id === product.id);
    if (exist) setCart(cart.map((x) => x.id === product.id ? { ...exist, quantity: exist.quantity + 1 } : x));
    else setCart([...cart, { ...product, quantity: 1 }]);
  };

  const updateQuantity = (product, change) => {
      const exist = cart.find((x) => x.id === product.id);
      if (exist.quantity + change > 0) setCart(cart.map((x) => x.id === product.id ? { ...exist, quantity: exist.quantity + change } : x));
      else setCart(cart.filter((x) => x.id !== product.id));
  };

  // --- CALCULATIONS ---
  const getSubtotal = () => cart.reduce((acc, item) => acc + (getRawPrice(item) * item.quantity), 0);
  const getTax = () => getSubtotal() * 0.19; // 19% Tax Visualization
  const getTotal = () => getSubtotal() + getTax();

  // --- CHECKOUT SUBMISSION ---
  // --- BULLETPROOF SUBMIT ORDER ---
  const submitOrder = async () => {
    setOrderStatus("Processing...");
    console.log("🚀 Starting Order Process...");

    try {
        // --- STEP 1: Create Cart ---
        // We force US country to match your Admin Products
        const createCartDraft = { currency: "US", country: "" };
        console.log("1. Creating Cart...", createCartDraft);
        
        const cartRes = await apiRoot.carts().post({ body: createCartDraft }).execute();
        const cartId = cartRes.body.id;
        let cartVersion = cartRes.body.version;
        
        console.log(`✅ Cart Created. ID: ${cartId}, Version: ${cartVersion}`);

        // --- STEP 2: Prepare Actions (Items + Address) ---
        // We bundle everything into one update to be safer
        const actions = [];

        // A. Add Items
        cart.map(item => {
            actions.push({
                action: "addLineItem",
                productId: item.id,
                variantId: item.masterData.current.masterVariant.id || 1,
                quantity: Number(item.quantity)
            });
        });

        // B. Add Shipping Address (Crucial!)
        actions.push({
            action: "setShippingAddress",
            address: {
                country: "US", // Keep US to match project settings
                city: checkoutForm.city || "Berlin",
                streetName: checkoutForm.street || "Main St",
                postalCode: checkoutForm.zip || "12345",
                firstName: user?.firstName || "Guest",
                lastName: user?.lastName || "User",
                email: user?.email || "guest@example.com"
            }
        });

        console.log("2. Sending Actions (Items + Address)...", actions);

        // --- STEP 3: Update Cart ---
        const updatedCart = await apiRoot.carts().withId({ ID: cartId }).post({
            body: { 
                version: cartVersion, 
                actions: actions 
            }
        }).execute();
        
        // Update version to the latest one
        cartVersion = updatedCart.body.version;
        console.log(`✅ Cart Updated. New Version: ${cartVersion}`);

        // --- STEP 4: Create Order ---
        const orderNumber = "ORD-" + Math.floor(Math.random() * 100000);
        console.log(`3. Creating Order #${orderNumber}...`);

        // Safety Check: If version is missing, STOP here
        if (!cartVersion) throw new Error("System Error: Cart Version is missing.");

        await apiRoot.orders().post({
            body: {
                id: cartId,
                version: cartVersion, // This MUST be the latest number
                orderNumber: orderNumber
            }
        }).execute();

        console.log("🎉 Order Success!");
        setOrderStatus("success");
        setCart([]);
        
        // Go back to shop after 3 seconds
        setTimeout(() => { 
            setOrderStatus(null); 
            setActiveTab('shop'); 
        }, 3000);

    } catch (err) {
        console.error("❌ ORDER FAILED:", err);
        setOrderStatus("error");
        alert("Order Failed: " + err.message);
    }
  };

  // --- ADMIN ACTIONS ---
  const handleAddProduct = async (e) => {
    e.preventDefault();
    try {
      let finalImageUrl = newProduct.imageUrl;
      if (selectedFile) {
          const s3Url = await uploadImageToS3();
          if (s3Url) finalImageUrl = s3Url;
      }

      const typeRes = await apiRoot.productTypes().get().execute();
      const typeId = typeRes.body.results[0].id;

      const draft = {
        key: "p-" + Math.now(),
        name: { "en-US": newProduct.name },
        productType: { typeId: "product-type", id: typeId },
        slug: { "en-US": "slug-" + Date.now() },
        masterVariant: {
          sku: "SKU-" + Date.now(),
          prices: [{ value: { currencyCode: "USD", centAmount: parseFloat(newProduct.price) * 100 }, country: "US" }],
          images: finalImageUrl ? [{ url: finalImageUrl, dimensions: { w: 300, h: 300 } }] : []
        }
      };
      
      const created = await apiRoot.products().post({ body: draft }).execute();
      await apiRoot.products().withId({ ID: created.body.id }).post({
        body: { version: created.body.version, actions: [{ action: "publish" }] }
      }).execute();

      alert("Product Created!");
      setNewProduct({ name: '', price: '', imageUrl: '' });
      setSelectedFile(null);
      fetchProducts();
    } catch (err) { alert(err.message); }
  };

  const handleUpdatePrice = async (e, productId) => {
    e.preventDefault();
    try {
        const pRes = await apiRoot.products().withId({ ID: productId }).get().execute();
        const product = pRes.body;
        await apiRoot.products().withId({ ID: product.id }).post({
            body: { version: product.version, actions: [{ action: "setPrices", variantId: product.masterData.current.masterVariant.id, prices: [{ value: { currencyCode: "USD", centAmount: parseFloat(editPrice.price) * 100 }, country: "US" }] }] }
        }).execute();
        const pRes2 = await apiRoot.products().withId({ ID: productId }).get().execute();
        await apiRoot.products().withId({ ID: productId }).post({
            body: { version: pRes2.body.version, actions: [{ action: "publish" }] }
        }).execute();
        alert("Price Updated!");
        fetchProducts();
    } catch(err) { alert(err.message); }
  };

  // --- RENDER VIEWS ---

  const renderAuth = (isSignup) => (
    <div className="auth-container">
      <h2>{isSignup ? "Create Account" : "Sign In"}</h2>
      <form onSubmit={isSignup ? handleSignup : handleLogin} className="auth-form">
        {isSignup && <><input type="text" name="firstName" placeholder="First Name" onChange={handleAuthInput} required /><input type="text" name="lastName" placeholder="Last Name" onChange={handleAuthInput} required /></>}
        <input type="email" name="email" placeholder="Email (admin@shopswift.com)" onChange={handleAuthInput} required />
        <input type="password" name="password" placeholder="Password" onChange={handleAuthInput} required />
        <button type="submit" className="submit-btn">{isSignup ? "Sign Up" : "Login"}</button>
      </form>
      <p onClick={() => setActiveTab(isSignup ? 'login' : 'signup')} className="switch-auth">{isSignup ? "Back to Login" : "Create Account"}</p>
    </div>
  );

  const renderCheckout = () => {
    if (orderStatus === "success") return <div className="success-message"><h2>🎉 Order Placed Successfully!</h2></div>;

    return (
      <div className="checkout-layout">
        <div className="checkout-main">
          <div className="checkout-header">
            <h2>Confirmation</h2>
            <div className="steps-indicator">Customer &gt; Items &gt; Shipping &gt; <b>Review</b></div>
          </div>
          <div className="section-card">
             <h3>Review</h3>
             <table className="review-table">
                <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th></tr></thead>
                <tbody>
                    {cart.map(item => (
                        <tr key={item.id}>
                            <td className="product-col">
                                <div className="prod-name">{getProductName(item)}</div>
                                <div className="prod-sku">SKU: {getSku(item)}</div>
                            </td>
                            <td>{formatPrice(getRawPrice(item))}</td>
                            <td>{item.quantity}</td>
                            <td>{formatPrice(getRawPrice(item) * item.quantity)}</td>
                        </tr>
                    ))}
                </tbody>
             </table>
          </div>
          <div className="section-card">
              <h3>Shipping Address</h3>
              <div className="address-grid">
                  <div className="address-box">
                      <p>Address: <input value={checkoutForm.street} onChange={e=>setCheckoutForm({...checkoutForm, street:e.target.value})} /></p>
                      <p>City: <input value={checkoutForm.city} onChange={e=>setCheckoutForm({...checkoutForm, city:e.target.value})} /></p>
                      <p>Zip: <input value={checkoutForm.zip} onChange={e=>setCheckoutForm({...checkoutForm, zip:e.target.value})} /></p>
                  </div>
              </div>
          </div>
          <div className="checkout-actions">
              <button className="cancel-btn" onClick={() => setActiveTab('cart')}>Back</button>
              <button className="place-order-btn" onClick={submitOrder} disabled={orderStatus === "Processing..."}>
                 {orderStatus === "Processing..." ? "Processing..." : "Place order"}
              </button>
          </div>
        </div>

        <div className="checkout-sidebar">
            <div className="summary-card">
                <h3>Order summary</h3>
                <div className="summary-user"><b>For {user?.firstName}</b><div>{user?.email}</div></div>
                <hr />
                <div className="summary-row text-green"><span>Tax (19%)</span><span>+ {formatPrice(getTax())}</span></div>
                <div className="summary-row final-total"><span>Final Total</span><span>{formatPrice(getTotal())}</span></div>
            </div>
        </div>
      </div>
    );
  };

  const renderAdmin = () => (
    <div className="admin-dashboard">
      <h2>👑 Admin Dashboard</h2>
      <div className="admin-section">
        <h3>Add Product</h3>
        <form onSubmit={handleAddProduct} className="admin-form">
          <input type="text" placeholder="Name" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} />
          <input type="number" placeholder="Price" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} />
          <div style={{width:'100%', marginTop:'10px'}}>
             <input type="file" onChange={handleFileSelect} />
             <p style={{fontSize:'12px'}}>{uploadStatus}</p>
          </div>
          <button type="submit">Create</button>
        </form>
      </div>
      <div className="admin-section">
          <h3>Orders</h3>
          <div className="admin-list">{orders.map(o => <div key={o.id} className="admin-row">Order #{o.orderNumber}</div>)}</div>
      </div>
      <div className="admin-section">
        <h3>Manage Prices</h3>
        {products.map(p => (
            <div key={p.id} className="admin-row">
                <span>{getProductName(p)}</span>
                <form onSubmit={(e) => { setEditPrice({...editPrice, productId: p.id}); handleUpdatePrice(e, p.id); }}>
                    <input type="number" onChange={e => setEditPrice({productId: p.id, price: e.target.value})} style={{width:'60px'}} />
                    <button type="submit">Save</button>
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
          {!user ? <button className="active">Please Login</button> : 
          <><button onClick={() => setActiveTab('shop')}>Shop</button>
            <button onClick={() => setActiveTab('cart')}>Cart ({cart.reduce((a,c)=>a+c.quantity,0)})</button>
            {isAdmin && <button onClick={() => setActiveTab('admin')} style={{color:'red'}}>Admin</button>}
            <button onClick={handleLogout} className="logout-btn">Logout</button></>}
        </div>
      </nav>
      <main className="content">
        {activeTab === 'login' && renderAuth(false)}
        {activeTab === 'signup' && renderAuth(true)}
        {activeTab === 'shop' && <div className="product-grid">{products.map(p => (
            <div key={p.id} className="product-card">
                <img src={getProductImage(p)} alt="p" />
                <h3>{getProductName(p)}</h3>
                <p>{formatPrice(getRawPrice(p))}</p>
                <button className="add-btn" onClick={() => addToCart(p)}>Add</button>
            </div>
        ))}</div>}
        {activeTab === 'cart' && <div className="cart-container">
            <h2>Your Cart</h2>
            {cart.map(i => <div key={i.id} className="cart-item">
                <img src={getProductImage(i)} width="50" alt="t"/>
                <div style={{flex:1, marginLeft:'10px'}}>{getProductName(i)}</div>
                <div className="quantity-controls"><button onClick={()=>updateQuantity(i,-1)}>-</button><span>{i.quantity}</span><button onClick={()=>updateQuantity(i,1)}>+</button></div>
            </div>)}
            {cart.length > 0 && <button className="checkout-btn" onClick={()=>setActiveTab('checkout')}>Checkout</button>}
        </div>}
        {activeTab === 'checkout' && renderCheckout()}
        {activeTab === 'admin' && renderAdmin()}
      </main>
    </div>
  );
}
export default App;