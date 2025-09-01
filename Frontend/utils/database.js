const mysql = require("mysql2/promise");

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const db = mysql.createPool(dbConfig);

(async () => {
    try {
        const connection = await db.getConnection();
        console.log("Connected to MySQL database");
        connection.release();
    } catch (err) {
        console.error("Database connection failed:", err);
    }
})();

async function executeQuery(sql, values = []) {
    try {
        const [results] = await db.execute(sql, values);
        return results;
    } catch (err) {
        console.error("Query Execution Error:", err);
        throw err;
    }
}

module.exports = {
    db,
    dbConfig,
    executeQuery,
};