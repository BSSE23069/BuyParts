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
// Function to convert all products to USD/US
const convertAllToUSD = () => {
  const savedProducts = JSON.parse(localStorage.getItem("products")) || [];
  const updatedProducts = savedProducts.map((p) => ({
    ...p,
    currency: "USD",     // set currency to USD
    country: "US"        // set country to US
  }));

  // Save back to localStorage
  localStorage.setItem("products", JSON.stringify(updatedProducts));
  setProducts(updatedProducts); // update state if needed
  alert("All products updated to USD/US!");
};

// Run this once on admin side or in useEffect
// convertAllToUSD();

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
  // --- SIMPLIFIED "ONE-CLICK" ORDER ---
  // --- DYNAMIC ORDER (DETECTS CURRENCY FROM PRODUCT) ---
  // --- ROBUST SUBMIT ORDER (FORCES US SETTINGS) ---
  const submitOrder = async () => {
    setOrderStatus("Processing...");
    console.log("🚀 Starting Order...");

    try {
        // --- STEP 1: FORCE US CART ---
        // We force "US" because your Admin Panel saves prices as "US".
        // This prevents the "Global vs Country" mismatch error.
        const createCartDraft = { 
            currency: "USD", 
            country: "US" 
        };
        
        const cartRes = await apiRoot.carts().post({ body: createCartDraft }).execute();
        const cartId = cartRes.body.id;
        let cartVersion = cartRes.body.version;

        // --- STEP 2: PREPARE ITEMS & ADDRESS ---
        const actions = [];

        // A. Add Items
        cart.forEach(item => {
            actions.push({
                action: "addLineItem",
                productId: item.id,
                variantId: item.masterData.current.masterVariant.id || 1,
                quantity: Number(item.quantity)
            });
        });

        // B. Set Hardcoded US Address (Matches the Cart Country)
        const orderName = checkoutForm.name || user?.firstName || "Guest";
        const orderEmail = checkoutForm.email || user?.email || "guest@shopswift.com";

        const addressData = {
            firstName: orderName.split(" ")[0],
            lastName: orderName.split(" ")[1] || "User",
            streetName: "123 Default Street",
            city: "New York", 
            postalCode: "10001",
            region: "NY",
            country: "US", // MATCHES CART COUNTRY
            email: orderEmail
        };

        actions.push({ action: "setShippingAddress", address: addressData });
        actions.push({ action: "setBillingAddress", address: addressData });

        // --- STEP 3: UPDATE CART ---
        const updatedCart = await apiRoot.carts().withId({ ID: cartId }).post({
            body: { version: cartVersion, actions: actions }
        }).execute();
        
        cartVersion = updatedCart.body.version;

        // --- STEP 4: PLACE ORDER ---
        const orderNumber = "ORD-" + Math.floor(Math.random() * 1000000);
        await apiRoot.orders().post({
            body: {
                id: cartId,
                version: cartVersion,
                orderNumber: orderNumber
            }
        }).execute();

        setOrderStatus("success");
        setCart([]);
        fetchOrders(); // Update Admin list
        setTimeout(() => { setOrderStatus(null); setActiveTab('shop'); }, 3000);

    } catch (err) {
        console.error("ORDER ERROR:", err);
        setOrderStatus("error");
        
        // Show the REAL error message from Commercetools
        let msg = err.message;
        if (err.body && err.body.message) msg = err.body.message;
        
        alert("Order Failed: " + msg);
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

 // --- UPDATED: HANDLE PRICE CHANGE FOR SPECIFIC VARIANT ---
  const handleUpdatePrice = async (e, productId, variantId, newPrice) => {
    e.preventDefault();
    if (!newPrice) return alert("Please enter a price");

    try {
        setOrderStatus("Updating..."); // Show loading status
        
        // 1. Get current version
        const pRes = await apiRoot.products().withId({ ID: productId }).get().execute();
        const product = pRes.body;
        
        // 2. Update Price for SPECIFIC Variant
        await apiRoot.products().withId({ ID: product.id }).post({
            body: {
                version: product.version,
                actions: [{
                    action: "setPrices",
                    variantId: variantId, // <--- TARGETS SPECIFIC VARIANT (1, 2, 3...)
                    prices: [{ 
                        value: { 
                            currencyCode: "USD", 
                            centAmount: parseFloat(newPrice) * 100 
                        }, 
                        country: "US" // Forces US Price to match Checkout
                    }]
                }]
            }
        }).execute();

        // 3. Publish Changes
        const pRes2 = await apiRoot.products().withId({ ID: productId }).get().execute();
        await apiRoot.products().withId({ ID: productId }).post({
            body: { version: pRes2.body.version, actions: [{ action: "publish" }] }
        }).execute();

        alert(`✅ Price updated for Variant ${variantId}!`);
        setOrderStatus(null);
        fetchProducts(); // Refresh list
    } catch(err) { 
        console.error(err);
        alert("Update Failed: " + err.message); 
        setOrderStatus(null);
    }
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
const renderCheckout = () => {
    if (orderStatus === "success") return <div className="success-message"><h2>🎉 Order Placed Successfully!</h2></div>;

    return (
      <div className="checkout-container">
        <form onSubmit={submitOrder} className="checkout-form">
            <h2>Finalize Order</h2>
            <p style={{textAlign:'center', color:'#666'}}>Shipping to: <b>123 Default St, New York, US</b></p>
            
            <div className="form-group">
                <label>Full Name</label>
                <input 
                    type="text" 
                    placeholder="Enter your name" 
                    value={checkoutForm.name || ""} 
                    onChange={e => setCheckoutForm({...checkoutForm, name: e.target.value})} 
                    required 
                />
            </div>

            <div className="form-group">
                <label>Email Address</label>
                <input 
                    type="email" 
                    placeholder="Enter your email" 
                    value={checkoutForm.email || ""} 
                    onChange={e => setCheckoutForm({...checkoutForm, email: e.target.value})} 
                    required 
                />
            </div>

            <div className="order-summary-box" style={{background:'#f9f9f9', padding:'15px', borderRadius:'8px', marginTop:'20px'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px'}}>
                    <span>Items ({cart.reduce((a,c)=>a+c.quantity,0)})</span>
                    <span>{formatPrice(getSubtotal())}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px', color:'green'}}>
                    <span>Tax (19%)</span>
                    <span>+ {formatPrice(getTax())}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', fontWeight:'bold', fontSize:'1.2rem', borderTop:'1px solid #ddd', paddingTop:'10px'}}>
                    <span>Total</span>
                    <span>{formatPrice(getTotal())}</span>
                </div>
            </div>

            <button type="submit" className="submit-order-btn" disabled={orderStatus === "Processing..."}>
                {orderStatus === "Processing..." ? "Processing..." : "Confirm & Pay"}
            </button>
            <button type="button" className="cancel-btn" onClick={() => setActiveTab('cart')}>Cancel</button>
        </form>
      </div>
    );
  };

 const renderAdmin = () => {
    // Helper to combine Master Variant + Other Variants into one list
    const getAllVariants = (p) => {
        const master = { ...p.masterData.current.masterVariant, isMaster: true };
        const others = p.masterData.current.variants || [];
        return [master, ...others];
    };

    return (
      <div className="admin-dashboard">
        <h2>👑 Admin Dashboard</h2>
        
        {/* ADD PRODUCT SECTION (Kept Simple) */}
        <div className="admin-section">
          <h3>Add New Product</h3>
          <form onSubmit={handleAddProduct} className="admin-form">
            <input type="text" placeholder="Name" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} />
            <input type="number" placeholder="Price" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} />
            <div style={{width:'100%', marginTop:'10px'}}>
               <input type="file" onChange={handleFileSelect} />
               <p style={{fontSize:'12px', color:'blue'}}>{uploadStatus}</p>
            </div>
            <button type="submit">Create</button>
          </form>
        </div>

        {/* ORDER LIST SECTION */}
        <div className="admin-section">
            <h3>Recent Orders</h3>
            <div className="admin-list">
                {orders.length === 0 ? <p>No orders found.</p> : orders.map(o => (
                    <div key={o.id} className="admin-row">
                        <strong>Order #{o.orderNumber}</strong> 
                        <span>{o.totalPrice ? formatPrice(o.totalPrice.centAmount/100) : "N/A"}</span>
                    </div>
                ))}
            </div>
        </div>

        {/* NEW: MANAGE ALL VARIANTS PRICES */}
        <div className="admin-section">
          <h3>Manage Product Prices (All Variants)</h3>
          {products.map(p => (
              <div key={p.id} style={{marginBottom:'20px', border:'1px solid #ddd', padding:'10px', borderRadius:'8px'}}>
                  <h4 style={{margin:'0 0 10px 0', color:'#4f46e5'}}>{getProductName(p)}</h4>
                  
                  {/* LOOP THROUGH EVERY VARIANT */}
                  {getAllVariants(p).map(variant => {
                      // Get current price if it exists
                      const currentPrice = variant.prices && variant.prices.length > 0 
                        ? variant.prices[0].value.centAmount / 100 
                        : 0;
                      
                      return (
                        <div key={variant.id} className="admin-row" style={{fontSize:'0.9rem'}}>
                            <div style={{display:'flex', alignItems:'center', gap:'10px', flex:1}}>
                                {variant.images && variant.images[0] && <img src={variant.images[0].url} width="30" alt="v" />}
                                <div>
                                    <div style={{fontWeight:'bold'}}>Variant ID: {variant.id} {variant.isMaster ? "(Master)" : ""}</div>
                                    <div style={{color:'#666'}}>SKU: {variant.sku || "No SKU"}</div>
                                </div>
                            </div>
                            
                            <div style={{marginRight:'15px', fontWeight:'bold', color: currentPrice === 0 ? 'red' : 'green'}}>
                                {currentPrice === 0 ? "NO PRICE" : formatPrice(currentPrice)}
                            </div>

                            {/* INDIVIDUAL FORM FOR THIS VARIANT */}
                            <form 
                                onSubmit={(e) => {
                                    // We use e.target[0].value to get the input value without creating 100 state variables
                                    const val = e.target[0].value;
                                    handleUpdatePrice(e, p.id, variant.id, val); 
                                    e.target[0].value = ""; // Clear input after submit
                                }} 
                                style={{display:'flex', gap:'5px'}}
                            >
                                <input type="number" placeholder="New Price" style={{width:'80px', padding:'5px'}} required />
                                <button type="submit" style={{padding:'5px 10px', fontSize:'0.8rem'}}>Set</button>
                            </form>
                        </div>
                      );
                  })}
              </div>
          ))}
        </div>
      </div>
    );
  };
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