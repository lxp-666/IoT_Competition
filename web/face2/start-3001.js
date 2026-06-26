process.env.PORT = "3001";

const { server } = require("./server.js");

server.listen(3001, "0.0.0.0", () => {
  console.log("face2 running at http://localhost:3001");
});
