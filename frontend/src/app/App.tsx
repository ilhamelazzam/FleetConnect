import { RouterProvider } from "react-router";

import { router } from "./routes";

function App() {
  return <RouterProvider router={router} fallbackElement={<div>Loading...</div>} />;
}

export default App;
