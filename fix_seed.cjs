const fs = require('fs');
let s = fs.readFileSync('seed.sql', 'utf8');

// Fix accountant password hash (was wrong)
s = s.replace(
  "'250dc3b4c58b8716c7c775368b08d457f892086968561095dc9dc8bf2be8cada'",
  "'80d02588132ccedfc7f6b15e1b162e512a2164fe50e8873fe85039376dd65e17'"
);

// Fix registrar password hash (was wrong)
s = s.replace(
  "'2cda63c1c62537b97faef5aaa06a08ef264b997130a3a3be47202236db8ec76e'",
  "'6fec04712803c852f0a7cae4ea971a31f24fb0305623894edef5c2b27db30045'"
);

fs.writeFileSync('seed.sql', s, 'utf8');
console.log('seed.sql password hashes fixed');
