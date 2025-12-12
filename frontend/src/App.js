import React, { useEffect, useState } from 'react';
import { apiRoot } from './commercetools-client';
import './App.css';

function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch products from Commercetools
    apiRoot
      .products()
      .get()
      .execute()
      .then((response) => {
        setProducts(response.body.results);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching products:", error);
        setLoading(false);
      });
  }, []);

  if (loading) return <h2>Loading ShopSwift...</h2>;

  return (
    <div className="App">
      <header>
        <h1>ShopSwift</h1>
      </header>
      <div className="product-grid">
        {products.map((product) => {
          // Commercetools data structure is nested
          const name = product.masterData.current.name.en || "Unknown Product";
          // Try to get the image, otherwise use a placeholder
          const image = product.masterData.current.masterVariant.images[0]?.url || "https://via.placeholder.com/150";
          
          return (
            <div key={product.id} className="product-card">
              <img src={image} alt={name} width="150" />
              <h3>{name}</h3>
              <button>Add to Cart</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;