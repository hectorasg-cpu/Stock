# Stock Campo

Aplicación simple para controlar stock de productos en Bodega, Envasado y Agrícola.

## Funciones

- Inventario por área.
- Registro de entradas, salidas y ajustes.
- Última reposición por producto.
- Último movimiento por producto.
- Alertas por stock bajo y por productos sin reposición reciente.
- Guardado local en el navegador.

## Ejecutar localmente

```bash
npm start
```

Luego abrir: http://localhost:3000

## Railway

Railway detecta el proyecto como Node.js y ejecuta:

```bash
npm start
```

La app usa el puerto entregado por Railway mediante `process.env.PORT`.
