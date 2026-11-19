// A redb-style database whose constructors return the crate's Result alias.
#[derive(Debug)]
pub struct Error;

pub type Result<T = ()> = std::result::Result<T, Error>;

pub struct Database;

pub struct WriteTransaction {
    id: u64,
}

impl Database {
    pub fn create(_path: &str) -> Result<Database> {
        Ok(Database)
    }
    pub fn begin_write(&self) -> Result<WriteTransaction> {
        Ok(WriteTransaction { id: 1 })
    }
    pub fn find(&self) -> Option<WriteTransaction> {
        None
    }
}

impl WriteTransaction {
    pub fn persistent_savepoint(&self) -> Result<u64> {
        Ok(self.id)
    }
    pub fn commit(self) -> Result {
        Ok(())
    }
}

pub fn usage() -> Result<u64> {
    let db = Database::create("x")?;
    let txn = db.begin_write()?;
    let id = txn.persistent_savepoint()?;
    txn.commit()?;
    if let Some(other) = db.find() {
        other.commit()?;
    }
    Ok(id)
}
