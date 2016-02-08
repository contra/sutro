/*global it: true, describe: true */
/*eslint no-console: 0*/
import should from 'should'
import sutro from '../src'
import request from 'supertest'
import express from 'express'

// import createModel from './fixtures/createModel'
//
// let User = createModel('user', {
//   id: String,
//   name: String
// })

let users = [ {
  id: 1,
  name: 'foo'
}, {
  id: 2,
  name: 'bar'
}, {
  id: 3,
  name: 'baz'
} ]

const app = express()

const api = sutro({
  resources: {
    user: {
      create: (opts, cb) => {
        return cb(null, { created: true })
        // TODO: sutro assumes body-parser?
        // TODO: why no 201 created?
      },
      find: (opts, cb) => {
        return cb(null, JSON.stringify(users))
      },
      findById: (opts, cb) => {
        return cb(null, users[opts.id - 1])
      },
      deleteById: (opts, cb) => {
        return cb(null, { deleted: true })
      },
      updateById: (opts, cb) => {
        return cb(null, { updated: true })
      },
      replaceById: (opts, cb) => {
        return cb(null, { replaced: true })
      }
    }
  }
})
app.use(api)


describe('sutro', () => {
  it('should export a function', () => {
    should.exist(sutro)
    sutro.should.be.a.function
  })

  it('should register a resource query endpoint', (done) => {
    request(app).get('/users')
      .expect(200, done)
  })

  it('should register a resource find endpoint', (done) => {
    request(app).get('/users/1')
      .expect(200, users[0])

    request(app).get('/users/2')
      .expect(200, users[1], done)
  })


  it('should register a resource creation endpoint', (done) => {
    request(app).post('/users')
      .expect(200, { created: true }, done)
  })

  it('should register a resource deletion endpoint', (done) => {
    request(app).delete('/users/1')
      .expect(200, { deleted: true }, done)
  })

  it('should register a resource replace endpoint', (done) => {
    request(app).put('/users/1')
      .expect(200, { replaced: true }, done)
  })

  it('should register a resource update endpoint', (done) => {
    request(app).patch('/users/1')
      .expect(200, { updated: true }, done)
  })
})
