require('dotenv').config();
const { getPool: obtenerPool } = require('./utils/db');
const bcrypt = require('bcrypt');

async function migrarContrasenas()
{
  const piscina = obtenerPool();
  let usuariosActualizados = 0;

  try
  {
    const [usuarios] = await piscina.execute(
      "SELECT id_usuario, password_hash FROM usuarios WHERE password_hash NOT LIKE '$2b$%'"
    );

    for(const usuario of usuarios)
    {
      const contrasenaHash = await bcrypt.hash(usuario.password_hash, 10);
      const [resultado] = await piscina.execute(
        'UPDATE usuarios SET password_hash = ? WHERE id_usuario = ? AND password_hash = ?',
        [contrasenaHash, usuario.id_usuario, usuario.password_hash]
      );
      usuariosActualizados += resultado.affectedRows;
    }
  }
  finally
  {
    console.log(`Usuarios actualizados exitosamente: ${usuariosActualizados}`);
    await piscina.end();
  }
}

migrarContrasenas().catch(error =>
{
  console.error('No se pudo completar la migración de contraseñas:', error.code || error.name);
  process.exitCode = 1;
});
